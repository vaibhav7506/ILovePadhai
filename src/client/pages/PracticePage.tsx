import { ArrowRight, Bot, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { TurnstileWidget, turnstileEnabled } from '../TurnstileWidget';
import { useVisitor } from '../visitor-context';

interface ExamConfiguration {
  slug: string;
  name: string;
  level: 'secondary' | 'graduate';
  tiers: string[];
  subjects: Record<string, string[]>;
  defaultDifficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  standardQuestions: number;
  standardDurationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  languages: ('en' | 'hi')[];
}

interface ActiveGeneration {
  attemptId: string;
  attemptToken: string;
}

const stages = [
  'Preparing examination pattern',
  'Generating questions',
  'Checking duplicates',
  'Verifying answers',
  'Test ready',
];

export function PracticePage() {
  const { visitorUuid, status } = useVisitor();
  const navigate = useNavigate();
  const [examinations, setExaminations] = useState<ExamConfiguration[]>([]);
  const [examSlug, setExamSlug] = useState('ssc-chsl');
  const [tier, setTier] = useState('');
  const [subject, setSubject] = useState('All subjects');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState(10);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [timerMode, setTimerMode] = useState<'standard' | 'custom' | 'untimed'>('custom');
  const [duration, setDuration] = useState(10);
  const [fullMock, setFullMock] = useState(false);
  const [nickname, setNickname] = useState('');
  const [starting, setStarting] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>();
  const [error, setError] = useState<string>();
  const [activeGeneration, setActiveGeneration] = useState<ActiveGeneration>();
  const [cooldownUntil, setCooldownUntil] = useState<number>();
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [automaticRetryAvailable, setAutomaticRetryAvailable] = useState(true);
  const generationInFlight = useRef(false);
  const continuationTimer = useRef<number | undefined>(undefined);
  const [clientRetrySeconds, setClientRetrySeconds] = useState(20);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileReset, setTurnstileReset] = useState(0);

  useEffect(() => {
    void fetch('/api/ai/config')
      .then(
        (response) =>
          response.json() as Promise<{
            examinations: ExamConfiguration[];
            clientRetrySeconds?: number;
          }>,
      )
      .then((data) => {
        setExaminations(data.examinations);
        if (data.clientRetrySeconds) setClientRetrySeconds(data.clientRetrySeconds);
      })
      .catch(() => {
        setError('AI test configuration could not be loaded.');
      });
  }, []);

  const selected = useMemo(
    () => examinations.find((exam) => exam.slug === examSlug),
    [examSlug, examinations],
  );
  useEffect(() => {
    if (!selected) return;
    setTier(selected.tiers[0] ?? '');
    setDifficulty(selected.defaultDifficulty);
  }, [selected]);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }
    const update = () => {
      setCooldownSeconds(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [cooldownUntil]);

  const runGeneration = useCallback(
    async (
      active: ActiveGeneration,
      retryMode: 'initial' | 'automatic' | 'manual',
    ): Promise<void> => {
      if (generationInFlight.current) return;
      generationInFlight.current = true;
      setStarting(true);
      setError(undefined);
      setCurrentStage(stages[0]);
      if (retryMode === 'automatic') setAutomaticRetryAvailable(false);
      try {
        const query = retryMode === 'automatic' ? '?retry=automatic' : '';
        const generatedResponse = await fetch(
          `/api/ai/attempts/${active.attemptId}/generate${query}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${active.attemptToken}` },
          },
        );
        const generated = (await generatedResponse.json()) as {
          error?: string;
          errorCode?: string;
          generationStatus?: string;
          recoverable?: boolean;
          retryAfterSeconds?: number;
          stage?: string;
          status?: string;
        };
        if (
          generatedResponse.status === 429 &&
          generated.errorCode === 'AI_RATE_LIMITED' &&
          generated.retryAfterSeconds
        ) {
          const seconds = Math.max(1, generated.retryAfterSeconds);
          if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
          setCooldownUntil(Date.now() + seconds * 1000);
          setCooldownSeconds(seconds);
          setCurrentStage(
            generated.stage === 'verification'
              ? 'Verification paused by provider cooldown'
              : 'Generation paused by provider cooldown',
          );
          setError(
            `Groq cooldown active. This attempt is saved and will be retried in ${String(seconds)} seconds.`,
          );
          setStarting(false);
          return;
        }
        const ready =
          generatedResponse.status === 200 ||
          generated.status === 'ready' ||
          generated.status === 'completed' ||
          generated.generationStatus === 'ready';
        if (ready) {
          if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
          localStorage.removeItem('examforge.pending_ai_attempt');
          localStorage.setItem('examforge.active_attempt', active.attemptId);
          setActiveGeneration(undefined);
          setCooldownUntil(undefined);
          await navigate(`/attempts/${active.attemptId}`);
          return;
        }
        if (generatedResponse.status === 409 && generated.recoverable === false) {
          if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
          localStorage.removeItem('examforge.pending_ai_attempt');
          setActiveGeneration(undefined);
          setTurnstileToken(undefined);
          setTurnstileReset((value) => value + 1);
          throw new Error(generated.error ?? 'This saved attempt cannot be resumed.');
        }
        if (!generatedResponse.ok && generatedResponse.status !== 202)
          throw new Error(generated.error ?? 'Question generation failed.');
        if (generated.stage === 'verification' || generated.status === 'verification_pending')
          setCurrentStage('Verifying answers');
        else setCurrentStage('Generating questions');
        const waitSeconds = Math.max(1, generated.retryAfterSeconds ?? clientRetrySeconds);
        if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
        continuationTimer.current = window.setTimeout(() => {
          void runGeneration(active, 'manual');
        }, waitSeconds * 1_000);
        setStarting(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Question generation failed.');
        setStarting(false);
        setCurrentStage(undefined);
      } finally {
        generationInFlight.current = false;
      }
    },
    [clientRetrySeconds, navigate],
  );

  useEffect(() => {
    const stored = localStorage.getItem('examforge.pending_ai_attempt');
    if (!stored || activeGeneration) return;
    try {
      const value = JSON.parse(stored) as Partial<ActiveGeneration>;
      if (
        typeof value.attemptId !== 'string' ||
        typeof value.attemptToken !== 'string' ||
        value.attemptToken.length < 20
      )
        return;
      const active = {
        attemptId: value.attemptId,
        attemptToken: value.attemptToken,
      };
      setActiveGeneration(active);
      void fetch(`/api/ai/attempts/${active.attemptId}/generation`, {
        headers: { Authorization: `Bearer ${active.attemptToken}` },
      })
        .then(
          (response) =>
            response.json() as Promise<{
              status?: string;
              stageLabel?: string;
              cooldownUntil?: string;
              retryStage?: string;
              autoRetryUsed?: number;
            }>,
        )
        .then((progress) => {
          if (progress.stageLabel) setCurrentStage(progress.stageLabel);
          if (progress.status === 'ready' || progress.status === 'completed') {
            localStorage.removeItem('examforge.pending_ai_attempt');
            void navigate(`/attempts/${active.attemptId}`);
            return;
          }
          if (progress.status === 'rate_limited' && progress.cooldownUntil) {
            setCooldownUntil(Date.parse(progress.cooldownUntil));
            setAutomaticRetryAvailable(progress.autoRetryUsed !== 1);
            setError(
              `Groq cooldown active. This saved ${progress.retryStage ?? 'generation'} stage remains recoverable.`,
            );
            return;
          }
          if (
            progress.status === 'pending' ||
            progress.status === 'generating' ||
            progress.status === 'verification_pending' ||
            progress.status === 'verifying' ||
            progress.status === 'retryable'
          )
            setStarting(false);
          if (
            progress.status === 'cancelled' ||
            progress.status === 'expired' ||
            progress.status === 'invalid'
          ) {
            localStorage.removeItem('examforge.pending_ai_attempt');
            setActiveGeneration(undefined);
            setError('The saved attempt ended and cannot be resumed. Create a new attempt.');
          }
        })
        .catch(() => {
          setError('The saved AI attempt could not be checked. Retry it manually.');
        });
    } catch {
      localStorage.removeItem('examforge.pending_ai_attempt');
    }
  }, [activeGeneration, navigate]);

  useEffect(() => {
    if (!activeGeneration) return;
    const checkProgress = async () => {
      try {
        const response = await fetch(`/api/ai/attempts/${activeGeneration.attemptId}/generation`, {
          headers: { Authorization: `Bearer ${activeGeneration.attemptToken}` },
        });
        const progress = (await response.json()) as {
          status?: string;
          stageLabel?: string;
          cooldownUntil?: string;
          retryStage?: string;
        };
        if (progress.stageLabel) setCurrentStage(progress.stageLabel);
        if (progress.status === 'ready' || progress.status === 'completed') {
          if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
          localStorage.removeItem('examforge.pending_ai_attempt');
          localStorage.setItem('examforge.active_attempt', activeGeneration.attemptId);
          setActiveGeneration(undefined);
          setCooldownUntil(undefined);
          await navigate(`/attempts/${activeGeneration.attemptId}`);
        } else if (progress.status === 'rate_limited' && progress.cooldownUntil) {
          setCooldownUntil(Date.parse(progress.cooldownUntil));
          setCurrentStage(
            progress.retryStage === 'verification'
              ? 'Verification paused by provider cooldown'
              : 'Generation paused by provider cooldown',
          );
        }
      } catch {
        // Polling is observational only; a later poll or explicit retry can recover.
      }
    };
    const timer = window.setInterval(() => {
      void checkProgress();
    }, clientRetrySeconds * 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeGeneration, clientRetrySeconds, navigate]);

  useEffect(
    () => () => {
      if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (
      cooldownUntil &&
      cooldownSeconds === 0 &&
      automaticRetryAvailable &&
      activeGeneration &&
      !generationInFlight.current
    )
      void runGeneration(activeGeneration, 'automatic');
  }, [activeGeneration, automaticRetryAvailable, cooldownSeconds, cooldownUntil, runGeneration]);

  const start = async () => {
    if (activeGeneration) {
      await runGeneration(activeGeneration, 'manual');
      return;
    }
    if (!visitorUuid || !selected || !tier || status !== 'ready') return;
    if (turnstileEnabled && !turnstileToken) {
      setError('Complete human verification before generating a test.');
      return;
    }
    setStarting(true);
    setError(undefined);
    setCurrentStage(stages[0]);
    try {
      const createResponse = await fetch('/api/ai/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorUuid,
          examinationSlug: selected.slug,
          tierStage: tier,
          subject,
          topic: topic || null,
          difficulty,
          questionCount: fullMock ? null : count,
          fullMock,
          language,
          timerMode,
          customDurationMinutes: timerMode === 'custom' ? duration : null,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
          allowRepetition: false,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
      const created = (await createResponse.json()) as {
        attemptId?: string;
        attemptToken?: string;
        error?: string;
      };
      if (!createResponse.ok || !created.attemptId || !created.attemptToken)
        throw new Error(created.error ?? 'Generation could not start.');
      const { attemptId, attemptToken } = created;
      localStorage.setItem(`examforge.attempt.${attemptId}.token`, attemptToken);
      const active = { attemptId, attemptToken };
      localStorage.setItem('examforge.pending_ai_attempt', JSON.stringify(active));
      setActiveGeneration(active);
      setAutomaticRetryAvailable(true);
      await runGeneration(active, 'initial');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Question generation failed.');
      setStarting(false);
      setCurrentStage(undefined);
      setTurnstileToken(undefined);
      setTurnstileReset((value) => value + 1);
    }
  };

  return (
    <div className="practice-page">
      <section className="practice-heading">
        <p className="eyebrow">PRACTICE WITH AI</p>
        <h1>Build a fresh test around the exam you are preparing for.</h1>
        <p>
          ExamForge generates the complete paper, checks duplicates, verifies answers, and only then
          starts the server timer.
        </p>
      </section>

      <section className="mode-grid" aria-label="AI test guarantees">
        <article>
          <Bot size={22} />
          <strong>Fresh question set</strong>
          <span>Stored history and fingerprints prevent silent repeats.</span>
        </article>
        <article>
          <ShieldCheck size={22} />
          <strong>Verified before timing</strong>
          <span>A separate model context checks every proposed answer.</span>
        </article>
        <article>
          <CheckCircle2 size={22} />
          <strong>Server-authoritative</strong>
          <span>Answers, marks, timer, submission and score stay on the server.</span>
        </article>
      </section>

      <section className="start-desk">
        <div>
          <p className="eyebrow">AI TEST CONFIGURATION</p>
          <h2>Choose exactly what to practise</h2>
          <label htmlFor="ai-exam">
            Examination
            <select
              id="ai-exam"
              value={examSlug}
              onChange={(event) => {
                setExamSlug(event.target.value);
                setSubject('All subjects');
                setTopic('');
              }}
            >
              {examinations.map((exam) => (
                <option key={exam.slug} value={exam.slug}>
                  {exam.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="ai-tier">
            Tier / stage
            <select
              id="ai-tier"
              value={tier}
              onChange={(event) => {
                setTier(event.target.value);
              }}
            >
              {selected?.tiers.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label htmlFor="ai-subject">
            Subject
            <select
              id="ai-subject"
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setTopic('');
              }}
            >
              <option>All subjects</option>
              {Object.keys(selected?.subjects ?? {}).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label htmlFor="ai-topic">
            Optional topic
            <select
              disabled={subject === 'All subjects'}
              id="ai-topic"
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value);
              }}
            >
              <option value="">Mixed topics</option>
              {(selected?.subjects[subject] ?? []).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label htmlFor="ai-difficulty">
            Difficulty
            <select
              id="ai-difficulty"
              value={difficulty}
              onChange={(event) => {
                setDifficulty(event.target.value);
              }}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label htmlFor="ai-language">
            Language
            <select
              id="ai-language"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as 'en' | 'hi');
              }}
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
        </div>
        <aside>
          <p className="eyebrow">PAPER & TIMER</p>
          <label className="checkbox-line">
            <input
              checked={fullMock}
              onChange={(event) => {
                setFullMock(event.target.checked);
              }}
              type="checkbox"
            />{' '}
            Full standard mock
          </label>
          {!fullMock && (
            <label htmlFor="ai-count">
              Questions
              <select
                id="ai-count"
                value={count}
                onChange={(event) => {
                  setCount(Number(event.target.value));
                }}
              >
                {[5, 10, 15, 20, 25, 50].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label htmlFor="ai-timer">
            Timer
            <select
              id="ai-timer"
              value={timerMode}
              onChange={(event) => {
                setTimerMode(event.target.value as typeof timerMode);
              }}
            >
              <option value="standard">Standard timer</option>
              <option value="custom">Custom timer</option>
              <option value="untimed">Untimed practice</option>
            </select>
          </label>
          {timerMode === 'custom' && (
            <label htmlFor="ai-duration">
              Minutes
              <input
                id="ai-duration"
                min={1}
                max={240}
                type="number"
                value={duration}
                onChange={(event) => {
                  setDuration(Number(event.target.value));
                }}
              />
            </label>
          )}
          <label htmlFor="ai-nickname">
            Optional leaderboard nickname
            <input
              id="ai-nickname"
              maxLength={24}
              placeholder="Learner number used by default"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
              }}
            />
          </label>
          {selected && (
            <dl>
              <div>
                <dt>Official mock</dt>
                <dd>
                  {selected.standardQuestions} questions / {selected.standardDurationMinutes} min
                </dd>
              </div>
              <div>
                <dt>Marking</dt>
                <dd>
                  +{selected.positiveMarks} / −{selected.negativeMarks}
                </dd>
              </div>
            </dl>
          )}
          {!fullMock && (
            <p className="muted-copy">Custom practice is not an official simulation.</p>
          )}
          {turnstileEnabled && !activeGeneration && (
            <TurnstileWidget
              action="generate"
              onToken={setTurnstileToken}
              resetKey={turnstileReset}
            />
          )}
          <button
            className="primary-button"
            disabled={
              starting ||
              cooldownSeconds > 0 ||
              (!activeGeneration && (!selected || status !== 'ready')) ||
              (!activeGeneration && turnstileEnabled && !turnstileToken)
            }
            onClick={() => void start()}
          >
            {cooldownSeconds > 0
              ? `Retry available in ${String(cooldownSeconds)}s`
              : starting
                ? (currentStage ?? 'Preparing examination pattern')
                : activeGeneration
                  ? 'Retry saved attempt'
                  : 'Start AI test'}{' '}
            {starting ? <Clock3 size={17} /> : <ArrowRight size={17} />}
          </button>
          {cooldownSeconds > 0 && (
            <p className="cooldown-status" role="status" aria-live="polite">
              Your generated questions are saved. Provider cooldown: {cooldownSeconds} seconds
              remaining.
            </p>
          )}
          {starting && (
            <ol className="generation-stages" aria-live="polite">
              {stages.map((stage) => (
                <li className={stage === currentStage ? 'active' : undefined} key={stage}>
                  {stage}
                </li>
              ))}
            </ol>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </section>
    </div>
  );
}
