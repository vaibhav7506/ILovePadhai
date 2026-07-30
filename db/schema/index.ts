import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export * from './content';

export const anonymousVisitors = sqliteTable(
  'anonymous_visitors',
  {
    visitorNumber: integer('visitor_number').primaryKey(),
    visitorUuid: text('visitor_uuid').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    visitCount: integer('visit_count').notNull().default(1),
    deviceCategory: text('device_category', {
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
    })
      .notNull()
      .default('unknown'),
  },
  (table) => [
    uniqueIndex('anonymous_visitors_uuid_unique').on(table.visitorUuid),
    index('anonymous_visitors_first_seen_idx').on(table.firstSeenAt),
  ],
);

export const visitorSessions = sqliteTable(
  'visitor_sessions',
  {
    sessionUuid: text('session_uuid').primaryKey(),
    visitorNumber: integer('visitor_number')
      .notNull()
      .references(() => anonymousVisitors.visitorNumber, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
    landingPath: text('landing_path').notNull(),
    referrerCategory: text('referrer_category', {
      enum: ['direct', 'search', 'social', 'referral', 'internal', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    deviceCategory: text('device_category', {
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
    })
      .notNull()
      .default('unknown'),
  },
  (table) => [index('visitor_sessions_visitor_idx').on(table.visitorNumber)],
);

export const pageEvents = sqliteTable(
  'page_events',
  {
    eventUuid: text('event_uuid').primaryKey(),
    visitorNumber: integer('visitor_number')
      .notNull()
      .references(() => anonymousVisitors.visitorNumber, { onDelete: 'cascade' }),
    sessionUuid: text('session_uuid')
      .notNull()
      .references(() => visitorSessions.sessionUuid, { onDelete: 'cascade' }),
    eventType: text('event_type', {
      enum: ['page_view', 'exam_selection', 'quiz_start', 'quiz_completion', 'page_exit'],
    }).notNull(),
    path: text('path').notNull(),
    examinationSlug: text('examination_slug'),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('page_events_session_idx').on(table.sessionUuid),
    index('page_events_type_date_idx').on(table.eventType, table.occurredAt),
  ],
);

export const consentPreferences = sqliteTable('consent_preferences', {
  visitorNumber: integer('visitor_number')
    .primaryKey()
    .references(() => anonymousVisitors.visitorNumber, { onDelete: 'cascade' }),
  anonymousAnalytics: integer('anonymous_analytics', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});
