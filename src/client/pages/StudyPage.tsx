import {
  BookMarked,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Clock3,
  Flame,
  NotebookPen,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useVisitor } from '../visitor-context';

interface Exam {
  slug: string;
  shortName: string;
  status: string;
}

interface Profile {
  targetExaminationSlug: string | null;
  targetExamination: string | null;
  expectedExamDate: string | null;
  dailyMinutes: number;
  paused: boolean;
  currentStreak: number;
}

interface Mastery {
  subject: string;
  topic: string;
  questionsSeen: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  totalTimeSeconds: number;
  masteryScore: number;
  lastPractisedAt: string;
}

interface Mistake {
  questionId: string;
  questionText: string;
  subject: string;
  topic: string;
  difficulty: string;
  sourceOutcome: string;
  mistakeReason: string | null;
  revisionStatus: string;
  nextReviewAt: string;
  reviewCount: number;
  bookmarked: number;
}

interface PlanItem {
  id: string;
  itemType: string;
  subject: string | null;
  topic: string | null;
  minutes: number;
  rationale: string;
  status: string;
  learningState?: string;
}

interface Dashboard {
  profile: Profile | null;
  mastery: Mastery[];
  mistakes: Mistake[];
  plan: PlanItem[];
  dueRevisionCount: number;
  studyProgress?: {
    completed: number;
    retryRequired: number;
    skipped: number;
    planned: number;
    completionPercent: number;
  };
}

interface LearningActivity {
  itemId: string;
  openedAt: number;
  state: string;
  lesson: { title: string; body: string; sourceStatus: string };
  check?: {
    checkId: string;
    passingPercent: number;
    questions: {
      id: string;
      questionText: string;
      options: { optionIndex: number; optionText: string }[];
    }[];
  };
}

interface CurrentAffair {
  id: string;
  headline: string;
  summary: string;
  topic: string;
  language: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedOn: string;
}

interface CalendarEvent {
  id: string;
  examination: string;
  eventType: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  sourceUrl: string;
}

const reasons = [
  ['concept_not_understood', 'Concept not understood'],
  ['formula_forgotten', 'Formula forgotten'],
  ['calculation_mistake', 'Calculation mistake'],
  ['guessed', 'Guessed'],
  ['read_incorrectly', 'Read question incorrectly'],
  ['time_pressure', 'Time pressure'],
] as const;

export function StudyPage() {
  const { visitorUuid, status } = useVisitor();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [exams, setExams] = useState<Exam[]>([]);
  const [currentAffairs, setCurrentAffairs] = useState<CurrentAffair[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [intelligence, setIntelligence] = useState<{
    available: boolean;
    verifiedQuestionCount: number;
    minimumRequired: number;
    disclaimer: string;
  }>();
  const [target, setTarget] = useState('');
  const [examDate, setExamDate] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [learning, setLearning] = useState<LearningActivity>();
  const [checkAnswers, setCheckAnswers] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!visitorUuid) return;
    const [dashboardResponse, contentResponse, affairsResponse, calendarResponse] =
      await Promise.all([
        fetch(`/api/study/dashboard?visitorUuid=${encodeURIComponent(visitorUuid)}`),
        fetch('/api/content/overview'),
        fetch('/api/current-affairs'),
        fetch('/api/exam-calendar'),
      ]);
    if (
      ![dashboardResponse, contentResponse, affairsResponse, calendarResponse].every(
        (item) => item.ok,
      )
    )
      throw new Error('The preparation desk could not be loaded.');
    const nextDashboard = (await dashboardResponse.json()) as Dashboard;
    const content = (await contentResponse.json()) as { examinations: Exam[] };
    const affairs = (await affairsResponse.json()) as { entries: CurrentAffair[] };
    const dates = (await calendarResponse.json()) as { events: CalendarEvent[] };
    setDashboard(nextDashboard);
    setExams(content.examinations);
    setCurrentAffairs(affairs.entries);
    setCalendar(dates.events);
    if (nextDashboard.profile) {
      setTarget(nextDashboard.profile.targetExaminationSlug ?? '');
      setExamDate(nextDashboard.profile.expectedExamDate ?? '');
      setDailyMinutes(nextDashboard.profile.dailyMinutes);
    }
  }, [visitorUuid]);

  useEffect(() => {
    if (status !== 'ready') return;
    void load().catch((error: unknown) => {
      setMessage(
        error instanceof Error ? error.message : 'The preparation desk could not be loaded.',
      );
    });
  }, [load, status]);

  useEffect(() => {
    const slug = dashboard?.profile?.targetExaminationSlug;
    if (!slug) {
      setIntelligence(undefined);
      return;
    }
    void fetch(`/api/intelligence/${encodeURIComponent(slug)}`)
      .then((response) => response.json())
      .then((data: typeof intelligence) => {
        setIntelligence(data);
      });
  }, [dashboard?.profile?.targetExaminationSlug]);

  const sortedMastery = useMemo(
    () => [...(dashboard?.mastery ?? [])].sort((a, b) => a.masteryScore - b.masteryScore),
    [dashboard?.mastery],
  );

  const saveProfile = async (paused = dashboard?.profile?.paused ?? false) => {
    if (!visitorUuid) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/study/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorUuid,
          targetExaminationSlug: target || null,
          expectedExamDate: examDate || null,
          dailyMinutes,
          paused,
        }),
      });
      if (!response.ok) throw new Error('Your study settings could not be saved.');
      await load();
      setMessage(paused ? 'Study plan paused.' : 'Study plan updated from your real evidence.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Your study settings could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const updatePlan = async (id: string, itemStatus: 'skipped') => {
    if (!visitorUuid) return;
    const response = await fetch(`/api/study/plan/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid, status: itemStatus }),
    });
    if (response.ok) await load();
  };

  const openLearning = async (id: string) => {
    if (!visitorUuid) return;
    const response = await fetch(`/api/study/plan/${id}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid }),
    });
    const result = (await response.json()) as {
      state?: string;
      lesson?: LearningActivity['lesson'];
      error?: string;
    };
    if (!response.ok || !result.lesson) {
      setMessage(result.error ?? 'The lesson could not be opened.');
      return;
    }
    setLearning({
      itemId: id,
      openedAt: Date.now(),
      state: result.state ?? 'reading',
      lesson: result.lesson,
    });
    setCheckAnswers({});
  };

  const unlockCheck = async () => {
    if (!visitorUuid || !learning) return;
    const visibleSeconds = Math.max(0, Math.floor((Date.now() - learning.openedAt) / 1000));
    const engagementResponse = await fetch(`/api/study/plan/${learning.itemId}/engagement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorUuid,
        engagedSeconds: visibleSeconds,
        visibleSeconds,
        scrollPercent: 100,
        sectionsOpened: 1,
        examplesInteracted: 0,
      }),
    });
    const engagement = (await engagementResponse.json()) as {
      state?: string;
      message?: string;
      error?: string;
    };
    if (engagement.state !== 'check_required') {
      setMessage(engagement.message ?? engagement.error ?? 'Continue reviewing the lesson.');
      return;
    }
    const checkResponse = await fetch(`/api/study/plan/${learning.itemId}/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid }),
    });
    const check = (await checkResponse.json()) as LearningActivity['check'] & { error?: string };
    if (!checkResponse.ok || !check.checkId) {
      setMessage(check.error ?? 'A verified check is not available.');
      return;
    }
    setLearning({ ...learning, state: 'check_required', check });
  };

  const submitCheck = async () => {
    if (!visitorUuid || !learning?.check) return;
    const response = await fetch(`/api/study/plan/${learning.itemId}/checks/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorUuid,
        checkId: learning.check.checkId,
        answers: learning.check.questions.map((question) => ({
          questionId: question.id,
          selectedOptionIndex: checkAnswers[question.id] ?? null,
        })),
      }),
    });
    const result = (await response.json()) as {
      passed?: boolean;
      scorePercent?: number;
      nextAction?: string;
      error?: string;
    };
    if (!response.ok) {
      setMessage(result.error ?? 'The check could not be scored.');
      return;
    }
    setMessage(
      `${result.passed ? 'Topic completed' : 'Retry required'} · ${String(result.scorePercent)}%. ${result.nextAction ?? ''}`,
    );
    setLearning(undefined);
    await load();
  };

  const updateMistake = async (questionId: string, mistakeReason: string) => {
    if (!visitorUuid) return;
    const response = await fetch(`/api/study/mistakes/${encodeURIComponent(questionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid, mistakeReason }),
    });
    if (response.ok) await load();
  };

  const review = async (questionId: string, correct: boolean) => {
    if (!visitorUuid) return;
    const response = await fetch(`/api/study/revisions/${encodeURIComponent(questionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid, correct, confidence: 3 }),
    });
    if (response.ok) await load();
  };

  return (
    <div className="study-page">
      <header className="study-hero">
        <div>
          <p className="eyebrow">PHASE 05 / PERSONALISED PREPARATION</p>
          <h1>Your mistakes become tomorrow’s worklist.</h1>
          <p>
            The plan responds to measured accuracy, topic coverage and due revision—not a generic
            timetable or an invented prediction.
          </p>
        </div>
        <div className="streak-block">
          <Flame aria-hidden="true" size={26} />
          <span>Current study streak</span>
          <strong>{dashboard?.profile?.currentStreak ?? 0} days</strong>
          <small>Stored against this anonymous browser only.</small>
        </div>
      </header>

      <section className="study-settings">
        <div>
          <p className="eyebrow">ANONYMOUS STUDY PROFILE</p>
          <h2>Set the time you actually have</h2>
        </div>
        <label>
          Target examination
          <select
            onChange={(event) => {
              setTarget(event.target.value);
            }}
            value={target}
          >
            <option value="">Choose later</option>
            {exams.map((exam) => (
              <option key={exam.slug} value={exam.slug}>
                {exam.shortName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected examination date
          <input
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => {
              setExamDate(event.target.value);
            }}
            type="date"
            value={examDate}
          />
        </label>
        <label>
          Available minutes each day
          <input
            max={720}
            min={15}
            onChange={(event) => {
              setDailyMinutes(Number(event.target.value));
            }}
            type="number"
            value={dailyMinutes}
          />
        </label>
        <div className="study-setting-actions">
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void saveProfile(false)}
          >
            <Play size={16} /> {dashboard?.profile ? 'Update plan' : 'Create my plan'}
          </button>
          {dashboard?.profile && (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => void saveProfile(!dashboard.profile?.paused)}
            >
              {dashboard.profile.paused ? <Play size={16} /> : <Pause size={16} />}
              {dashboard.profile.paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
      </section>

      {message && (
        <p className="study-message" role="status">
          {message}
        </p>
      )}

      {!dashboard?.profile ? (
        <section className="study-onboarding">
          <Target size={30} />
          <h2>Create the study profile without creating an account.</h2>
          <p>
            A diagnostic test will create one automatically. You can also set a target and daily
            time above, then take your first verified test.
          </p>
          <Link className="primary-button" to="/practice">
            Take a diagnostic test
          </Link>
        </section>
      ) : (
        <>
          <section className="daily-plan">
            <div className="study-section-heading">
              <div>
                <p className="eyebrow">TODAY / ADAPTIVE PLAN</p>
                <h2>
                  {dashboard.profile.paused
                    ? 'Plan paused'
                    : `${String(dashboard.profile.dailyMinutes)} focused minutes`}
                </h2>
              </div>
              <span>{dashboard.dueRevisionCount} revisions due</span>
            </div>
            {dashboard.studyProgress && (
              <p className="study-message">
                {dashboard.studyProgress.completionPercent}% complete ·{' '}
                {dashboard.studyProgress.completed} passed · {dashboard.studyProgress.retryRequired}{' '}
                retry · {dashboard.studyProgress.skipped} skipped
              </p>
            )}
            {dashboard.plan.length === 0 ? (
              <p className="honest-empty">
                {dashboard.profile.paused
                  ? 'Resume when you are ready. Pausing does not erase your evidence.'
                  : 'No plan item is available yet. Complete a diagnostic test to measure topics.'}
              </p>
            ) : (
              <div className="plan-list">
                {dashboard.plan.map((item, index) => (
                  <article key={item.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <small>{item.itemType.replaceAll('_', ' ')}</small>
                      <h3>{item.topic ?? item.subject ?? 'Baseline mock'}</h3>
                      <p>{item.rationale}</p>
                    </div>
                    <strong>{item.minutes} min</strong>
                    {item.status === 'planned' ? (
                      <div>
                        <button onClick={() => void openLearning(item.id)}>
                          <BookOpenCheck size={15} /> Open topic
                        </button>
                        <button onClick={() => void updatePlan(item.id, 'skipped')}>Skip</button>
                      </div>
                    ) : (
                      <em>{item.status}</em>
                    )}
                  </article>
                ))}
              </div>
            )}
            {learning && (
              <article className="learning-activity" aria-live="polite">
                <p className="eyebrow">{learning.lesson.sourceStatus.replaceAll('_', ' ')}</p>
                <h3>{learning.lesson.title}</h3>
                <p>{learning.lesson.body}</p>
                {!learning.check ? (
                  <button className="primary-button" onClick={() => void unlockCheck()}>
                    I reviewed the key sections · Start check
                  </button>
                ) : (
                  <div>
                    <p>
                      Pass mark: {learning.check.passingPercent}%. Answers remain hidden until
                      submission.
                    </p>
                    {learning.check.questions.map((question, questionIndex) => (
                      <fieldset key={question.id}>
                        <legend>
                          {questionIndex + 1}. {question.questionText}
                        </legend>
                        {question.options.map((option) => (
                          <label key={option.optionIndex}>
                            <input
                              checked={checkAnswers[question.id] === option.optionIndex}
                              name={question.id}
                              onChange={() => {
                                setCheckAnswers((current) => ({
                                  ...current,
                                  [question.id]: option.optionIndex,
                                }));
                              }}
                              type="radio"
                            />
                            {option.optionText}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    <button className="primary-button" onClick={() => void submitCheck()}>
                      Submit comprehension check
                    </button>
                  </div>
                )}
              </article>
            )}
          </section>

          <section className="mastery-section">
            <div className="study-section-heading">
              <div>
                <p className="eyebrow">TOPIC MASTERY / ATTEMPT EVIDENCE</p>
                <h2>Weak first, strong still revisited</h2>
              </div>
              <BrainCircuit size={25} />
            </div>
            {sortedMastery.length === 0 ? (
              <p className="honest-empty">No scored topic evidence yet.</p>
            ) : (
              <div className="mastery-table">
                {sortedMastery.map((item) => (
                  <article key={`${item.subject}:${item.topic}`}>
                    <div>
                      <strong>{item.topic}</strong>
                      <small>
                        {item.subject} · {item.questionsSeen} questions
                      </small>
                    </div>
                    <div
                      className="mastery-meter"
                      aria-label={`${String(item.masteryScore)}% mastery`}
                    >
                      <span style={{ width: `${String(item.masteryScore)}%` }} />
                    </div>
                    <b>{item.masteryScore}%</b>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="mistake-section">
            <div className="study-section-heading">
              <div>
                <p className="eyebrow">MISTAKE NOTEBOOK / SPACED REVISION</p>
                <h2>Questions that need another pass</h2>
              </div>
              <NotebookPen size={25} />
            </div>
            {dashboard.mistakes.length === 0 ? (
              <p className="honest-empty">
                Incorrect, skipped and marked questions will be saved here after a real attempt.
              </p>
            ) : (
              <div className="mistake-list">
                {dashboard.mistakes.map((item) => (
                  <article key={item.questionId}>
                    <div className="mistake-meta">
                      <span>{item.sourceOutcome}</span>
                      <span>
                        {item.subject} · {item.topic} · {item.difficulty}
                      </span>
                    </div>
                    <h3>{item.questionText}</h3>
                    <label>
                      What happened?
                      <select
                        onChange={(event) =>
                          void updateMistake(item.questionId, event.target.value)
                        }
                        value={item.mistakeReason ?? ''}
                      >
                        <option value="">Record a reason</option>
                        {reasons.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <footer>
                      <span>
                        <Clock3 size={14} /> Next:{' '}
                        {new Date(item.nextReviewAt).toLocaleDateString('en-IN')}
                      </span>
                      <button onClick={() => void review(item.questionId, false)}>
                        Still difficult
                      </button>
                      <button onClick={() => void review(item.questionId, true)}>
                        Recalled correctly
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="study-reference-grid">
        <article>
          <BookMarked size={23} />
          <p className="eyebrow">PYQ INTELLIGENCE</p>
          <h2>Historical topic signals</h2>
          {intelligence?.available ? (
            <p>{intelligence.verifiedQuestionCount} verified PYQs support this analysis.</p>
          ) : (
            <p>
              {intelligence
                ? `${String(intelligence.verifiedQuestionCount)} of ${String(intelligence.minimumRequired)} verified PYQs available. Trends remain hidden.`
                : 'Choose a target examination to check verified historical coverage.'}
            </p>
          )}
          <small>{intelligence?.disclaimer}</small>
        </article>
        <article>
          <Sparkles size={23} />
          <p className="eyebrow">GROUNDED DOUBTS</p>
          <h2>AI is optional, sources are not</h2>
          <p>
            The assistant appears inside published question review and uses only verified
            explanations, approved notes and official sources.
          </p>
          <small>Stored explanations continue working when Groq is disabled.</small>
        </article>
      </section>

      <section className="source-feed">
        <div className="study-section-heading">
          <div>
            <p className="eyebrow">VERIFIED CURRENT AFFAIRS</p>
            <h2>Source before summary</h2>
          </div>
          <RefreshCw size={23} />
        </div>
        {currentAffairs.length === 0 ? (
          <p className="honest-empty">
            No cited current-affairs entry has passed publication review.
          </p>
        ) : (
          currentAffairs.map((entry) => (
            <article key={entry.id}>
              <small>
                {entry.topic} · {entry.publishedOn} · {entry.language}
              </small>
              <h3>{entry.headline}</h3>
              <p>{entry.summary}</p>
              <a href={entry.sourceUrl} rel="noreferrer" target="_blank">
                {entry.sourceTitle}
              </a>
            </article>
          ))
        )}
      </section>

      <section className="source-feed">
        <div className="study-section-heading">
          <div>
            <p className="eyebrow">OFFICIAL EXAM CALENDAR</p>
            <h2>Dates with traceable notices</h2>
          </div>
          <CalendarDays size={23} />
        </div>
        {calendar.length === 0 ? (
          <p className="honest-empty">No official calendar event has passed verification yet.</p>
        ) : (
          calendar.map((event) => (
            <article key={event.id}>
              <small>
                {event.examination} · {event.eventType.replaceAll('_', ' ')}
              </small>
              <h3>{event.title}</h3>
              <p>
                {event.startsOn}
                {event.endsOn ? ` – ${event.endsOn}` : ''}
              </p>
              <a href={event.sourceUrl} rel="noreferrer" target="_blank">
                Official notice
              </a>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
