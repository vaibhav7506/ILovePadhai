import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eraser,
  Flag,
  Gauge,
  Save,
  Send,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useVisitor } from '../visitor-context';

interface Option {
  optionIndex: number;
  optionText: string;
}

interface AttemptQuestion {
  id: string;
  position: number;
  section: string;
  topic: string;
  positiveMarks: number;
  negativeMarks: number;
  questionText: string;
  selectedOptionIndex: number | null;
  markedForReview: number | boolean;
  visited: number | boolean;
  clientRevision: number;
  timeSpentSeconds: number;
  options: Option[];
}

interface AttemptPayload {
  attempt: {
    id: string;
    mode: string;
    status: string;
    durationSeconds: number;
    startedAt: string;
    expiresAt: string;
    score: Score | null;
  };
  questions: AttemptQuestion[];
  serverTime: string;
}

interface Score {
  correct: number;
  incorrect: number;
  unattempted: number;
  finalScore: number;
  accuracy: number;
  completionTimeSeconds: number;
  averageTimePerQuestionSeconds: number;
  maxMarks: number;
  negativeMarks: number;
  sections: Record<string, Breakdown>;
  subjects: Record<string, Breakdown>;
  topics: Record<string, Breakdown>;
  difficulties: Record<string, Breakdown>;
}

interface Breakdown {
  correct: number;
  incorrect: number;
  unattempted: number;
  score: number;
  total: number;
  maxMarks: number;
  accuracy: number;
  averageTimeSeconds: number;
}

interface ResultQuestion {
  id: string;
  position: number;
  questionText: string;
  explanationMarkdown: string | null;
  selectedOptionIndex: number | null;
  correctOptionIndex: number;
  outcome: 'correct' | 'incorrect' | 'unattempted';
  scoreAwarded: number;
  sourcePage: number;
  officialQuestionId: string | null;
  sourceUrl: string;
  relatedNote: string | null;
}

interface ResultPayload {
  status: string;
  score: Score;
  questions: ResultQuestion[];
}

interface PendingResponse {
  selectedOptionIndex: number | null;
  markedForReview: boolean;
  clientElapsedSeconds: number;
  questionElapsedSeconds: number;
  clientRevision: number;
  mutationId: string;
}

interface PhaseFourPayload {
  insights: {
    strongestSection: { name: string } | null;
    weakestSection: { name: string } | null;
    timeManagementIssues: string[];
    revisionQuestions: number;
  };
  integrity: { status: string; flags: string[]; leaderboardEligible: boolean };
  comparison: {
    comparableAttempts: number;
    previous: Score | null;
    first: Score | null;
    personalBest: Score | null;
    recentAverage: { score: number; accuracy: number } | null;
    deltaFromPrevious: {
      score: number;
      accuracy: number;
      seconds: number;
      negativeMarks: number;
    } | null;
  };
  cutoff: {
    status: 'above' | 'near' | 'below' | 'insufficient';
    previousCutoff: number | null;
    userScore: number;
    difference: number | null;
    years: number[];
    historicalRange: { minimum: number; maximum: number } | null;
    saferTarget: number | null;
    message: string;
  };
  readiness: {
    score: number;
    provisional: boolean;
    components: { label: string; value: number; weight: number; evidence: string }[];
    disclaimer: string;
  };
  rank:
    | { available: true; rank: number; cohortSize: number; percentile: number }
    | { available: false; cohortSize: number; reason: string };
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

export function AttemptPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { visitorUuid } = useVisitor();
  const token = localStorage.getItem(`examforge.attempt.${id}.token`);
  const [payload, setPayload] = useState<AttemptPayload>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [syncState, setSyncState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<ResultPayload>();
  const [phaseFour, setPhaseFour] = useState<PhaseFourPayload>();
  const [reportedQuestion, setReportedQuestion] = useState<string>();
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Set<string>>(new Set());
  const [doubtQuestion, setDoubtQuestion] = useState<string>();
  const [doubtText, setDoubtText] = useState('');
  const [doubtAnswer, setDoubtAnswer] = useState<{
    answer: string | null;
    sources: { title: string; url: string }[];
    aiGenerated?: boolean | undefined;
  }>();
  const [askingDoubt, setAskingDoubt] = useState(false);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    if (!token) throw new Error('This browser does not hold the signed attempt token.');
    const response = await fetch(`/api/attempts/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('The attempt could not be recovered.');
    const result = (await response.json()) as AttemptPayload;
    const pending = new Map<string, PendingResponse>();
    const recoveredQuestions = result.questions.map((item) => {
      const raw = localStorage.getItem(`examforge.attempt.${id}.pending.${item.id}`);
      if (!raw) return item;
      try {
        const saved = JSON.parse(raw) as PendingResponse;
        if (saved.clientRevision <= item.clientRevision) {
          localStorage.removeItem(`examforge.attempt.${id}.pending.${item.id}`);
          return item;
        }
        pending.set(item.id, saved);
        return {
          ...item,
          selectedOptionIndex: saved.selectedOptionIndex,
          markedForReview: saved.markedForReview,
          visited: true,
          clientRevision: saved.clientRevision,
        };
      } catch {
        localStorage.removeItem(`examforge.attempt.${id}.pending.${item.id}`);
        return item;
      }
    });
    setPayload({ ...result, questions: recoveredQuestions });
    setRemaining(
      Math.max(
        0,
        Math.floor((Date.parse(result.attempt.expiresAt) - Date.parse(result.serverTime)) / 1000),
      ),
    );
    await Promise.all(
      [...pending].map(async ([questionId, saved]) => {
        try {
          const retry = await fetch(`/api/attempts/${id}/responses/${questionId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(saved),
          });
          if (retry.ok) localStorage.removeItem(`examforge.attempt.${id}.pending.${questionId}`);
        } catch {
          // The local recovery record remains until a later successful load.
        }
      }),
    );
  }, [id, token]);

  useEffect(() => {
    void load().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Attempt recovery failed.');
    });
    const recover = () => {
      void load().catch(() => {
        setSyncState('offline');
      });
    };
    window.addEventListener('online', recover);
    return () => {
      window.removeEventListener('online', recover);
    };
  }, [load]);

  const submit = useCallback(async () => {
    if (!token || submitting.current) return;
    submitting.current = true;
    try {
      if (!navigator.onLine) throw new Error('Reconnect before final submission.');
      await load();
      const hasPending = Object.keys(localStorage).some((key) =>
        key.startsWith(`examforge.attempt.${id}.pending.`),
      );
      if (hasPending) throw new Error('Some responses are still syncing. Try submission again.');
      const response = await fetch(`/api/attempts/${id}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Submission could not be confirmed.');
      await load();
      localStorage.removeItem('examforge.active_attempt');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Submission failed.');
    } finally {
      submitting.current = false;
    }
  }, [id, load, token]);

  useEffect(() => {
    if (payload?.attempt.status !== 'active') return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          void submit();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [payload, submit]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (payload?.attempt.status === 'active') event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [payload?.attempt.status]);

  useEffect(() => {
    if (!token || !payload || payload.attempt.status === 'active') return;
    void Promise.all([
      fetch(`/api/attempts/${id}/results`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`/api/attempts/${id}/phase-four`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(async ([resultResponse, phaseFourResponse]) => {
        if (!resultResponse.ok || !phaseFourResponse.ok)
          throw new Error('Result analysis could not be loaded.');
        setResults((await resultResponse.json()) as ResultPayload);
        setPhaseFour((await phaseFourResponse.json()) as PhaseFourPayload);
      })
      .catch((resultError: unknown) => {
        setError(resultError instanceof Error ? resultError.message : 'Question review failed.');
      });
  }, [id, payload, token]);

  const questions = useMemo(() => payload?.questions ?? [], [payload?.questions]);
  const question = questions[currentIndex];
  const elapsed = payload ? Math.max(0, payload.attempt.durationSeconds - remaining) : 0;

  const saveResponse = async (
    selectedOptionIndex: number | null,
    markedForReview: boolean,
    moveNext: boolean,
  ) => {
    if (!question || !token || !payload) return;
    const revision = question.clientRevision + 1;
    setPayload({
      ...payload,
      questions: questions.map((item) =>
        item.id === question.id
          ? {
              ...item,
              selectedOptionIndex,
              markedForReview,
              visited: true,
              clientRevision: revision,
            }
          : item,
      ),
    });
    setSyncState('saving');
    const pendingResponse: PendingResponse = {
      selectedOptionIndex,
      markedForReview,
      clientElapsedSeconds: elapsed,
      clientRevision: revision,
      mutationId: crypto.randomUUID(),
      questionElapsedSeconds: Math.max(
        question.timeSpentSeconds,
        Math.floor((performance.now() - questionStartedAt.current) / 1000) +
          question.timeSpentSeconds,
      ),
    };
    try {
      const response = await fetch(`/api/attempts/${id}/responses/${question.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingResponse),
      });
      if (!response.ok) throw new Error('Response sync failed.');
      localStorage.removeItem(`examforge.attempt.${id}.pending.${question.id}`);
      setSyncState('saved');
      if (moveNext && currentIndex < questions.length - 1) setCurrentIndex(currentIndex + 1);
    } catch {
      localStorage.setItem(
        `examforge.attempt.${id}.pending.${question.id}`,
        JSON.stringify(pendingResponse),
      );
      setSyncState('offline');
      setError('Your change is kept on screen. Reconnect and save again before submission.');
      void navigator.serviceWorker.ready.then(async (registration) => {
        const sync = Reflect.get(registration, 'sync') as
          { register: (tag: string) => Promise<void> } | undefined;
        await sync?.register('examforge-attempt-recovery');
      });
    }
  };

  const questionStartedAt = useRef(performance.now());

  useEffect(() => {
    questionStartedAt.current = performance.now();
  }, [currentIndex]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setCurrentIndex((index) => Math.max(0, index - 1));
      if (event.key === 'ArrowRight')
        setCurrentIndex((index) => Math.min(questions.length - 1, index + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [questions.length]);

  const paletteStatuses = useMemo(
    () =>
      questions.map((item, index) => {
        if (index === currentIndex) return 'current';
        if (item.selectedOptionIndex !== null && item.markedForReview) return 'answered-marked';
        if (item.markedForReview) return 'marked';
        if (item.selectedOptionIndex !== null) return 'answered';
        if (item.visited) return 'unanswered';
        return 'not-visited';
      }),
    [currentIndex, questions],
  );

  if (error && !payload) {
    return (
      <section className="simple-page">
        <h1>Attempt unavailable</h1>
        <p>{error}</p>
      </section>
    );
  }
  if (!payload || !question) {
    return (
      <section className="simple-page">
        <p className="eyebrow">RECOVERING ATTEMPT</p>
        <h1>Your paper is loading…</h1>
      </section>
    );
  }
  if (payload.attempt.status !== 'active') {
    const score = payload.attempt.score;
    return (
      <div className="result-page">
        <p className="eyebrow">ATTEMPT FINAL / SERVER SCORED</p>
        <h1>{payload.attempt.status === 'timed_out' ? 'Time called.' : 'Paper submitted.'}</h1>
        {score && (
          <section className="score-grid">
            <article>
              <span>Final score</span>
              <strong>
                {score.finalScore} <small>/ {score.maxMarks}</small>
              </strong>
            </article>
            <article>
              <span>Correct</span>
              <strong>{score.correct}</strong>
            </article>
            <article>
              <span>Correct / incorrect / skipped</span>
              <strong className="compact-score">
                {score.correct} / {score.incorrect} / {score.unattempted}
              </strong>
            </article>
            <article>
              <span>Accuracy</span>
              <strong>{score.accuracy}%</strong>
            </article>
            <article>
              <span>Time used</span>
              <strong>{formatTime(score.completionTimeSeconds)}</strong>
              <small>{score.averageTimePerQuestionSeconds}s average per question</small>
            </article>
            <article>
              <span>Negative marks lost</span>
              <strong>−{score.negativeMarks}</strong>
            </article>
          </section>
        )}
        {score && phaseFour && (
          <>
            <section className="result-dashboard" aria-label="Performance analysis">
              <article className="readiness-card">
                <div>
                  <p className="eyebrow">READINESS / TRANSPARENT INDICATOR</p>
                  <h2>
                    {phaseFour.readiness.score}
                    <small>/100</small>
                  </h2>
                  <p>
                    {phaseFour.readiness.provisional ? 'Provisional · ' : ''}
                    {phaseFour.readiness.disclaimer}
                  </p>
                </div>
                <Gauge aria-hidden="true" size={42} />
              </article>
              <article>
                <Target aria-hidden="true" size={22} />
                <span>Strongest section</span>
                <strong>
                  {phaseFour.insights.strongestSection?.name ?? 'Not enough evidence'}
                </strong>
                <small>
                  Weakest: {phaseFour.insights.weakestSection?.name ?? 'Not enough evidence'}
                </small>
              </article>
              <article>
                <Clock3 aria-hidden="true" size={22} />
                <span>Revision queue</span>
                <strong>{phaseFour.insights.revisionQuestions} questions</strong>
                <small>
                  {phaseFour.insights.timeManagementIssues[0] ??
                    'No clear time-management issue detected.'}
                </small>
              </article>
              <article>
                <BarChart3 aria-hidden="true" size={22} />
                <span>Rank / percentile</span>
                <strong>
                  {phaseFour.rank.available
                    ? `#${String(phaseFour.rank.rank)} · ${String(phaseFour.rank.percentile)}th`
                    : 'Not available yet'}
                </strong>
                <small>
                  {phaseFour.rank.available
                    ? `${String(phaseFour.rank.cohortSize)} legitimate comparable learners`
                    : phaseFour.rank.reason}
                </small>
              </article>
              <article className={`cutoff-card ${phaseFour.cutoff.status}`}>
                <TrendingUp aria-hidden="true" size={22} />
                <span>Verified cutoff comparison</span>
                <strong>
                  {phaseFour.cutoff.previousCutoff === null
                    ? 'Insufficient matching data'
                    : `${phaseFour.cutoff.status} · ${(phaseFour.cutoff.difference ?? 0) >= 0 ? '+' : ''}${String(phaseFour.cutoff.difference)}`}
                </strong>
                <small>
                  {phaseFour.cutoff.previousCutoff === null
                    ? phaseFour.cutoff.message
                    : `Previous ${String(phaseFour.cutoff.previousCutoff)} · safer target ${String(phaseFour.cutoff.saferTarget)} · ${phaseFour.cutoff.message}`}
                </small>
              </article>
              <article>
                <ShieldCheck aria-hidden="true" size={22} />
                <span>Integrity review</span>
                <strong>{phaseFour.integrity.status}</strong>
                <small>
                  {phaseFour.integrity.leaderboardEligible
                    ? 'Eligible for exact-match leaderboards.'
                    : 'Held outside leaderboards pending review.'}
                </small>
              </article>
            </section>

            {phaseFour.comparison.deltaFromPrevious && (
              <section className="comparison-strip">
                <div>
                  <p className="eyebrow">REPEAT ATTEMPT / REAL DELTAS</p>
                  <h2>Compared with your previous comparable paper</h2>
                </div>
                <dl>
                  <div>
                    <dt>Score</dt>
                    <dd>{phaseFour.comparison.deltaFromPrevious.score}</dd>
                  </div>
                  <div>
                    <dt>Accuracy</dt>
                    <dd>{phaseFour.comparison.deltaFromPrevious.accuracy} pp</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{phaseFour.comparison.deltaFromPrevious.seconds}s</dd>
                  </div>
                  <div>
                    <dt>Negative loss</dt>
                    <dd>{phaseFour.comparison.deltaFromPrevious.negativeMarks}</dd>
                  </div>
                </dl>
              </section>
            )}

            <section className="breakdown-section">
              <div>
                <p className="eyebrow">EVIDENCE BREAKDOWN</p>
                <h2>Where the marks came from</h2>
              </div>
              {(
                [
                  ['Subject', score.subjects],
                  ['Topic', score.topics],
                  ['Difficulty', score.difficulties],
                ] as const
              ).map(([label, breakdown]) => (
                <article key={label}>
                  <h3>{label}</h3>
                  <div className="breakdown-table" role="table" aria-label={`${label} breakdown`}>
                    {Object.entries(breakdown).map(([name, item]) => (
                      <div className="breakdown-row" role="row" key={name}>
                        <strong role="cell">{name}</strong>
                        <span role="cell">
                          {item.score}/{item.maxMarks} marks
                        </span>
                        <span role="cell">{item.accuracy}% accuracy</span>
                        <span role="cell">{item.averageTimeSeconds}s / question</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
        {results && (
          <section className="answer-review">
            <div>
              <p className="eyebrow">VERIFIED ANSWER REVIEW</p>
              <h2>Question-level evidence</h2>
            </div>
            {results.questions.map((result) => (
              <article key={result.id}>
                <div className={`outcome ${result.outcome}`}>{result.outcome}</div>
                <h3>
                  {String(result.position).padStart(2, '0')} / {result.questionText}
                </h3>
                <p>
                  Your answer:{' '}
                  <strong>
                    {result.selectedOptionIndex === null
                      ? 'Unattempted'
                      : String.fromCharCode(65 + result.selectedOptionIndex)}
                  </strong>
                  {' · '}Correct answer:{' '}
                  <strong>{String.fromCharCode(65 + result.correctOptionIndex)}</strong>
                </p>
                <p>{result.explanationMarkdown ?? 'No verified explanation is published yet.'}</p>
                <footer>
                  <a href={result.sourceUrl} rel="noreferrer" target="_blank">
                    Official source · page {result.sourcePage}
                    {result.officialQuestionId ? ` · ${result.officialQuestionId}` : ''}
                  </a>
                  {result.relatedNote && <span>Related note: {result.relatedNote}</span>}
                  <button
                    disabled={!visitorUuid || reportedQuestion === result.id}
                    onClick={() => {
                      if (!visitorUuid) return;
                      void fetch(`/api/questions/${result.id}/reports`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          visitorUuid,
                          reason: 'answer_may_be_incorrect',
                        }),
                      }).then((response) => {
                        if (response.ok || response.status === 409) setReportedQuestion(result.id);
                      });
                    }}
                    type="button"
                  >
                    {reportedQuestion === result.id ? 'Report received' : 'Report answer'}
                  </button>
                  <button
                    disabled={!visitorUuid || bookmarkedQuestions.has(result.id)}
                    onClick={() => {
                      if (!visitorUuid) return;
                      void fetch(`/api/study/mistakes/${result.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ visitorUuid, bookmarked: true }),
                      }).then((response) => {
                        if (response.ok)
                          setBookmarkedQuestions((current) => new Set([...current, result.id]));
                      });
                    }}
                    type="button"
                  >
                    {bookmarkedQuestions.has(result.id) ? 'Bookmarked' : 'Bookmark for revision'}
                  </button>
                  <button
                    onClick={() => {
                      setDoubtQuestion(doubtQuestion === result.id ? undefined : result.id);
                      setDoubtAnswer(undefined);
                      setDoubtText('');
                    }}
                    type="button"
                  >
                    Ask grounded doubt
                  </button>
                </footer>
                {doubtQuestion === result.id && (
                  <div className="doubt-panel">
                    <label htmlFor={`doubt-${result.id}`}>
                      Ask about this verified question
                      <textarea
                        id={`doubt-${result.id}`}
                        maxLength={800}
                        onChange={(event) => {
                          setDoubtText(event.target.value);
                        }}
                        placeholder="Which verified step is unclear?"
                        rows={3}
                        value={doubtText}
                      />
                    </label>
                    <button
                      disabled={!visitorUuid || doubtText.trim().length < 3 || askingDoubt}
                      onClick={() => {
                        if (!visitorUuid) return;
                        setAskingDoubt(true);
                        void fetch('/api/doubts', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            visitorUuid,
                            questionId: result.id,
                            question: doubtText,
                          }),
                        })
                          .then(async (response) => {
                            const data = (await response.json()) as {
                              answer?: string;
                              sources?: { title: string; url: string }[];
                              aiGenerated?: boolean;
                              error?: string;
                            };
                            if (!response.ok) throw new Error(data.error ?? 'Doubt unavailable.');
                            setDoubtAnswer({
                              answer: data.answer ?? 'Verified material is insufficient.',
                              sources: data.sources ?? [],
                              aiGenerated: data.aiGenerated,
                            });
                          })
                          .catch((doubtError: unknown) => {
                            setDoubtAnswer({
                              answer:
                                doubtError instanceof Error
                                  ? doubtError.message
                                  : 'Doubt unavailable.',
                              sources: [],
                            });
                          })
                          .finally(() => {
                            setAskingDoubt(false);
                          });
                      }}
                      type="button"
                    >
                      {askingDoubt ? 'Checking verified material…' : 'Ask from verified material'}
                    </button>
                    {doubtAnswer && (
                      <div className="doubt-answer" role="status">
                        <small>
                          {doubtAnswer.aiGenerated
                            ? 'AI-assisted · verify against the cited source'
                            : 'Stored verified explanation'}
                        </small>
                        <p>{doubtAnswer.answer}</p>
                        {doubtAnswer.sources.map((source) => (
                          <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                            {source.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" onClick={() => void navigate('/practice')}>
          Return to practice desk
        </button>
      </div>
    );
  }

  return (
    <div aria-label="Examination workspace" className="attempt-page" tabIndex={-1}>
      <header className="attempt-bar">
        <div>
          <p className="eyebrow">{payload.attempt.mode.replaceAll('_', ' ')}</p>
          <strong>
            Question {currentIndex + 1} of {questions.length}
          </strong>
        </div>
        <div className={`sync-indicator ${syncState}`} aria-live="polite">
          {syncState === 'saved'
            ? 'Saved to server'
            : syncState === 'saving'
              ? 'Saving…'
              : 'Connection interrupted'}
        </div>
        <time aria-label={`${String(remaining)} seconds remaining`}>{formatTime(remaining)}</time>
      </header>
      <div className="attempt-layout">
        <section className="question-sheet">
          <div className="question-meta">
            <span>{question.section}</span>
            <span>{question.topic}</span>
            <span>
              +{question.positiveMarks} / −{question.negativeMarks}
            </span>
          </div>
          <h1>{question.questionText}</h1>
          <fieldset>
            <legend>Select one answer</legend>
            {question.options.map((option) => (
              <label
                className={question.selectedOptionIndex === option.optionIndex ? 'chosen' : ''}
                htmlFor={`question-${question.id}-option-${String(option.optionIndex)}`}
                key={option.optionIndex}
              >
                <input
                  checked={question.selectedOptionIndex === option.optionIndex}
                  id={`question-${question.id}-option-${String(option.optionIndex)}`}
                  name={`question-${question.id}`}
                  onChange={() =>
                    void saveResponse(option.optionIndex, Boolean(question.markedForReview), false)
                  }
                  type="radio"
                />
                <span>{String.fromCharCode(65 + option.optionIndex)}</span>
                {option.optionText}
              </label>
            ))}
          </fieldset>
          <div className="question-actions">
            <button
              disabled={currentIndex === 0}
              onClick={() => {
                setCurrentIndex(currentIndex - 1);
              }}
            >
              <ChevronLeft size={17} /> Previous
            </button>
            <button onClick={() => void saveResponse(null, false, false)}>
              <Eraser size={17} /> Clear response
            </button>
            <button
              className={question.markedForReview ? 'marked' : ''}
              onClick={() =>
                void saveResponse(question.selectedOptionIndex, !question.markedForReview, false)
              }
            >
              <Flag size={17} /> Mark for review
            </button>
            <button
              className="save-next"
              onClick={() =>
                void saveResponse(
                  question.selectedOptionIndex,
                  Boolean(question.markedForReview),
                  true,
                )
              }
            >
              <Save size={17} /> Save and next
            </button>
            <button
              disabled={currentIndex === questions.length - 1}
              onClick={() => {
                setCurrentIndex(currentIndex + 1);
              }}
            >
              Next <ChevronRight size={17} />
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="omr-panel">
          <p className="eyebrow">RESPONSE PALETTE</p>
          <div className="palette" aria-label="Question navigation">
            {questions.map((item, index) => (
              <button
                aria-label={`Question ${String(index + 1)}: ${paletteStatuses[index] ?? 'not-visited'}`}
                className={paletteStatuses[index]}
                key={item.id}
                onClick={() => {
                  setCurrentIndex(index);
                }}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <div className="palette-key">
            <span>
              <i className="answered" /> Answered
            </span>
            <span>
              <i className="marked" /> Review
            </span>
            <span>
              <i className="unanswered" /> Unanswered
            </span>
          </div>
          <button className="submit-attempt" onClick={() => void submit()}>
            <Send size={17} /> Submit final paper
          </button>
        </aside>
      </div>
    </div>
  );
}
