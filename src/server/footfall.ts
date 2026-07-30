import type { VisitorRegistration } from '@shared/visitor';

interface VisitorRow {
  visitor_number: number;
}

interface CountRow {
  total: number;
}

interface TodayCountRow {
  total: number;
}

export interface FootfallSnapshot {
  learnerNumber: number;
  totalLearners: number;
  totalVisits: number;
  visitorsToday: number;
  returningVisitors: number;
}

export interface RegistrationResult extends FootfallSnapshot {
  isNewLearner: boolean;
  isNewSession: boolean;
}

function firstRow<T>(result: D1Result<T>): T {
  const first = result.results[0];
  if (!first) throw new Error('Expected a database row but received none.');
  return first;
}

export async function registerVisitor(
  db: D1Database,
  cache: KVNamespace,
  input: VisitorRegistration,
  now = new Date(),
): Promise<RegistrationResult> {
  const timestamp = now.toISOString();

  const insertResult = await db
    .prepare(
      `INSERT INTO anonymous_visitors
       (visitor_number, visitor_uuid, first_seen_at, last_seen_at, visit_count, device_category)
       SELECT COALESCE(MAX(visitor_number), 0) + 1, ?, ?, ?, 1, ?
       FROM anonymous_visitors
       WHERE NOT EXISTS (
         SELECT 1 FROM anonymous_visitors WHERE visitor_uuid = ?
       )
       ON CONFLICT(visitor_uuid) DO NOTHING`,
    )
    .bind(input.visitorUuid, timestamp, timestamp, input.deviceCategory, input.visitorUuid)
    .run();

  const isNewLearner = insertResult.meta.changes > 0;
  const visitor = firstRow(
    await db
      .prepare('SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?')
      .bind(input.visitorUuid)
      .all<VisitorRow>(),
  );

  const sessionResult = await db
    .prepare(
      `INSERT OR IGNORE INTO visitor_sessions
       (session_uuid, visitor_number, started_at, last_activity_at, landing_path,
        referrer_category, device_category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.sessionUuid,
      visitor.visitor_number,
      timestamp,
      timestamp,
      input.landingPath,
      input.referrerCategory,
      input.deviceCategory,
    )
    .run();

  const isNewSession = sessionResult.meta.changes > 0;
  if (isNewSession && !isNewLearner) {
    await db
      .prepare(
        `UPDATE anonymous_visitors
         SET last_seen_at = ?, visit_count = visit_count + 1
         WHERE visitor_number = ?`,
      )
      .bind(timestamp, visitor.visitor_number)
      .run();
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO consent_preferences
       (visitor_number, anonymous_analytics, updated_at) VALUES (?, 1, ?)`,
    )
    .bind(visitor.visitor_number, timestamp)
    .run();

  const [learnerCount, visitCount, todayCount, returningCount] = await db.batch<
    CountRow | TodayCountRow
  >([
    db.prepare('SELECT COUNT(*) AS total FROM anonymous_visitors'),
    db.prepare('SELECT COUNT(*) AS total FROM visitor_sessions'),
    db
      .prepare('SELECT COUNT(*) AS total FROM anonymous_visitors WHERE first_seen_at >= ?')
      .bind(`${timestamp.slice(0, 10)}T00:00:00.000Z`),
    db.prepare('SELECT COUNT(*) AS total FROM anonymous_visitors WHERE visit_count > 1'),
  ]);

  const totalLearners = firstRow(learnerCount as D1Result<CountRow>).total;
  await cache.put('public:footfall', String(totalLearners), { expirationTtl: 60 });

  return {
    learnerNumber: visitor.visitor_number,
    totalLearners,
    totalVisits: firstRow(visitCount as D1Result<CountRow>).total,
    visitorsToday: firstRow(todayCount as D1Result<TodayCountRow>).total,
    returningVisitors: firstRow(returningCount as D1Result<CountRow>).total,
    isNewLearner,
    isNewSession,
  };
}

export async function getPublicFootfall(db: D1Database, cache: KVNamespace): Promise<number> {
  const cached = await cache.get('public:footfall');
  if (cached !== null && /^\d+$/.test(cached)) return Number(cached);

  const result = await db
    .prepare('SELECT COUNT(*) AS total FROM anonymous_visitors')
    .all<CountRow>();
  const total = firstRow(result).total;
  await cache.put('public:footfall', String(total), { expirationTtl: 60 });
  return total;
}
