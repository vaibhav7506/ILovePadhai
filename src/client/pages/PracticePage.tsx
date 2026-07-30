import { ArrowRight, Bot, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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
  languages: Array<'en' | 'hi'>;
}

const stages = ['Preparing examination pattern', 'Generating questions', 'Checking duplicates', 'Verifying answers', 'Test ready'];

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

  useEffect(() => {
    void fetch('/api/ai/config')
      .then((response) => response.json() as Promise<{ examinations: ExamConfiguration[] }>)
      .then((data) => setExaminations(data.examinations))
      .catch(() => setError('AI test configuration could not be loaded.'));
  }, []);

  const selected = useMemo(() => examinations.find((exam) => exam.slug === examSlug), [examSlug, examinations]);
  useEffect(() => {
    if (!selected) return;
    setTier(selected.tiers[0] ?? '');
    setDifficulty(selected.defaultDifficulty);
  }, [selected]);

  const start = async () => {
    if (!visitorUuid || !selected || !tier || status !== 'ready') return;
    setStarting(true);
    setError(undefined);
    setCurrentStage(stages[0]);
    try {
      const createResponse = await fetch('/api/ai/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorUuid, examinationSlug: selected.slug, tierStage: tier, subject,
          topic: topic || null, difficulty, questionCount: fullMock ? null : count,
          fullMock, language, timerMode, customDurationMinutes: timerMode === 'custom' ? duration : null,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}), allowRepetition: false,
        }),
      });
      const created = (await createResponse.json()) as { attemptId?: string; attemptToken?: string; error?: string };
      if (!createResponse.ok || !created.attemptId || !created.attemptToken) throw new Error(created.error ?? 'Generation could not start.');
      const { attemptId, attemptToken } = created;
      localStorage.setItem(`examforge.attempt.${attemptId}.token`, attemptToken);
      const generation = fetch(`/api/ai/attempts/${attemptId}/generate`, { method: 'POST', headers: { Authorization: `Bearer ${attemptToken}` } });
      let finished = false;
      while (!finished) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        const progressResponse = await fetch(`/api/ai/attempts/${attemptId}/generation`, { headers: { Authorization: `Bearer ${attemptToken}` } });
        const progress = (await progressResponse.json()) as { status?: string; stageLabel?: string; error?: string };
        if (progress.stageLabel) setCurrentStage(progress.stageLabel);
        finished = progress.status === 'completed' || progress.status === 'failed' || progress.status === 'exhausted';
      }
      const generatedResponse = await generation;
      const generated = (await generatedResponse.json()) as { error?: string };
      if (!generatedResponse.ok) throw new Error(generated.error ?? 'Question generation failed.');
      localStorage.setItem('examforge.active_attempt', attemptId);
      await navigate(`/attempts/${attemptId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Question generation failed.');
      setStarting(false);
      setCurrentStage(undefined);
    }
  };

  return (
    <div className="practice-page">
      <section className="practice-heading">
        <p className="eyebrow">PRACTICE WITH AI</p>
        <h1>Build a fresh test around the exam you are preparing for.</h1>
        <p>ExamForge generates the complete paper, checks duplicates, verifies answers, and only then starts the server timer.</p>
      </section>

      <section className="mode-grid" aria-label="AI test guarantees">
        <article><Bot size={22} /><strong>Fresh question set</strong><span>Stored history and fingerprints prevent silent repeats.</span></article>
        <article><ShieldCheck size={22} /><strong>Verified before timing</strong><span>A separate model context checks every proposed answer.</span></article>
        <article><CheckCircle2 size={22} /><strong>Server-authoritative</strong><span>Answers, marks, timer, submission and score stay on the server.</span></article>
      </section>

      <section className="start-desk">
        <div>
          <p className="eyebrow">AI TEST CONFIGURATION</p>
          <h2>Choose exactly what to practise</h2>
          <label htmlFor="ai-exam">Examination
            <select id="ai-exam" value={examSlug} onChange={(event) => { setExamSlug(event.target.value); setSubject('All subjects'); setTopic(''); }}>
              {examinations.map((exam) => <option key={exam.slug} value={exam.slug}>{exam.name}</option>)}
            </select>
          </label>
          <label htmlFor="ai-tier">Tier / stage
            <select id="ai-tier" value={tier} onChange={(event) => setTier(event.target.value)}>
              {selected?.tiers.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label htmlFor="ai-subject">Subject
            <select id="ai-subject" value={subject} onChange={(event) => { setSubject(event.target.value); setTopic(''); }}>
              <option>All subjects</option>
              {Object.keys(selected?.subjects ?? {}).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label htmlFor="ai-topic">Optional topic
            <select disabled={subject === 'All subjects'} id="ai-topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
              <option value="">Mixed topics</option>
              {(selected?.subjects[subject] ?? []).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label htmlFor="ai-difficulty">Difficulty
            <select id="ai-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option>
            </select>
          </label>
          <label htmlFor="ai-language">Language
            <select id="ai-language" value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'hi')}>
              <option value="en">English</option><option value="hi">Hindi</option>
            </select>
          </label>
        </div>
        <aside>
          <p className="eyebrow">PAPER & TIMER</p>
          <label className="checkbox-line"><input checked={fullMock} onChange={(event) => setFullMock(event.target.checked)} type="checkbox" /> Full standard mock</label>
          {!fullMock && <label htmlFor="ai-count">Questions
            <select id="ai-count" value={count} onChange={(event) => setCount(Number(event.target.value))}>
              {[5, 10, 15, 20, 25, 50].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>}
          <label htmlFor="ai-timer">Timer
            <select id="ai-timer" value={timerMode} onChange={(event) => setTimerMode(event.target.value as typeof timerMode)}>
              <option value="standard">Standard timer</option><option value="custom">Custom timer</option><option value="untimed">Untimed practice</option>
            </select>
          </label>
          {timerMode === 'custom' && <label htmlFor="ai-duration">Minutes<input id="ai-duration" min={1} max={240} type="number" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>}
          <label htmlFor="ai-nickname">Optional leaderboard nickname<input id="ai-nickname" maxLength={24} placeholder="Learner number used by default" value={nickname} onChange={(event) => setNickname(event.target.value)} /></label>
          {selected && <dl><div><dt>Official mock</dt><dd>{selected.standardQuestions} questions / {selected.standardDurationMinutes} min</dd></div><div><dt>Marking</dt><dd>+{selected.positiveMarks} / −{selected.negativeMarks}</dd></div></dl>}
          {!fullMock && <p className="muted-copy">Custom practice is not an official simulation.</p>}
          <button className="primary-button" disabled={starting || !selected || status !== 'ready'} onClick={() => void start()}>
            {starting ? (currentStage ?? 'Preparing examination pattern') : 'Start AI test'} {starting ? <Clock3 size={17} /> : <ArrowRight size={17} />}
          </button>
          {starting && <ol className="generation-stages" aria-live="polite">{stages.map((stage) => <li className={stage === currentStage ? 'active' : undefined} key={stage}>{stage}</li>)}</ol>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </aside>
      </section>
    </div>
  );
}
