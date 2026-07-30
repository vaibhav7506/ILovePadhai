import { examinations } from '@shared/catalogue';
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  Clock3,
  FileCheck2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useVisitor } from '../visitor-context';

function OmrMotif() {
  return (
    <div className="omr-motif" aria-label="Example OMR answer states">
      <span className="answered">
        <Check size={16} />
      </span>
      <span />
      <span className="review">3</span>
      <span className="current">4</span>
      <span />
      <span />
      <span className="answered">
        <Check size={16} />
      </span>
      <span />
    </div>
  );
}

function ExamColumn({ title, level }: { title: string; level: 'secondary' | 'graduate' }) {
  const items = examinations.filter((exam) => exam.level === level);
  return (
    <section className="exam-column" aria-labelledby={`${level}-heading`}>
      <div className="column-heading">
        <span className="level-stamp">{level === 'secondary' ? '10+2' : 'UG'}</span>
        <div>
          <p className="eyebrow">EXAMINATION LEVEL</p>
          <h2 id={`${level}-heading`}>{title}</h2>
        </div>
      </div>
      <div className="exam-list">
        {items.map((exam, index) => (
          <Link className="exam-row" key={exam.slug} to="/practice">
            <span className="exam-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="exam-copy">
              <strong>{exam.shortName}</strong>
              <small>{exam.fullName}</small>
            </span>
            <span className="verification-label">
              <Sparkles size={14} />
              Create AI test
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const { registration, status } = useVisitor();
  const previousAttempt = useMemo(() => localStorage.getItem('examforge.active_attempt'), []);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">YOUR PUBLIC EXAMINATION DESK</p>
          <h1>
            Practise a fresh test. <em>Know where you stand.</em>
          </h1>
          <p className="hero-intro">
            Previous-year papers, honest progress and examination-realistic practice — built without
            accounts or personal profiles.
          </p>
          <Link className="primary-button" to="/practice">
            Start AI test <ArrowRight size={17} />
          </Link>
          <div className="trust-line">
            <span>
              <Check size={16} /> No account required
            </span>
            <span>
              <Check size={16} /> Official sources take priority
            </span>
          </div>
        </div>
        <div className="hero-sheet">
          <div className="sheet-label">
            <span>RESPONSE RECORD</span>
            <span>FORM · 01</span>
          </div>
          <OmrMotif />
          <div className="footfall-card" aria-live="polite">
            {status === 'loading' && (
              <>
                <span className="loading-line wide" />
                <span className="loading-line" />
              </>
            )}
            {status === 'unavailable' && (
              <>
                <strong>Learner count unavailable</strong>
                <p>We will never replace it with a made-up number.</p>
              </>
            )}
            {status === 'ready' && registration && (
              <>
                <p className="eyebrow">PUBLIC FOOTFALL</p>
                <strong>
                  You’re learner #{registration.learnerNumber.toLocaleString('en-IN')}
                </strong>
                <p>
                  {(registration.learnerNumber - 1).toLocaleString('en-IN')}{' '}
                  {registration.learnerNumber === 2 ? 'learner arrived' : 'learners arrived'} before
                  you.
                </p>
              </>
            )}
          </div>
          <p className="sheet-note">One anonymous browser ID = one learner.</p>
        </div>
      </section>

      <section className="catalogue-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SELECT YOUR EXAMINATION</p>
            <h2>One desk. Two qualification levels.</h2>
          </div>
          <p>
            We unlock an examination only after its sources and rules are checked. No substitute
            questions are shown.
          </p>
        </div>
        <div className="exam-columns">
          <ExamColumn title="10th–12th level" level="secondary" />
          <ExamColumn title="Graduation level" level="graduate" />
        </div>
      </section>

      <section className="workspace-section">
        <article className="workspace-primary">
          <div className="workspace-icon">
            <RotateCcw size={22} />
          </div>
          <div>
            <p className="eyebrow">YOUR DESK</p>
            <h2>{previousAttempt ? 'Continue your previous attempt' : 'Your desk is ready'}</h2>
            <p>
              {previousAttempt
                ? 'A saved attempt was found in this browser.'
                : 'Attempts will be saved to this browser when verified papers become available.'}
            </p>
          </div>
          <Link className="primary-button" to={previousAttempt ? `/attempts/${previousAttempt}` : '/practice'}>
            {previousAttempt ? 'Continue attempt' : 'No attempt yet'}
            <ArrowRight size={17} />
          </Link>
        </article>
        <div className="workspace-actions">
          <article>
            <Sparkles size={20} />
            <h3>Practice with AI</h3>
            <p>Configure subject, topic, difficulty, language and timer.</p>
            <Link to="/practice">Start AI test</Link>
          </article>
          <article>
            <BookOpenCheck size={20} />
            <h3>Daily revision</h3>
            <p>Return to weak and due topics without guesswork.</p>
            <Link to="/study">Open study plan</Link>
          </article>
          <article>
            <FileCheck2 size={20} />
            <h3>Leaderboard preview</h3>
            <p>Only comparable tests are ranked. No fake learners or scores.</p>
            <Link to="/leaderboards">View leaderboards</Link>
          </article>
        </div>
      </section>

      <section className="notice-board">
        <div className="notice-column">
          <div className="notice-title">
            <FileCheck2 size={20} />
            <div>
              <p className="eyebrow">SOURCE-CHECKED</p>
              <h2>Recent verified papers</h2>
            </div>
          </div>
          <div className="empty-notice">
            <span>—</span>
            <p>
              <strong>No verified papers published yet.</strong>
              Official papers will appear here only after source and answer-key review.
            </p>
          </div>
        </div>
        <div className="notice-column">
          <div className="notice-title">
            <CalendarDays size={20} />
            <div>
              <p className="eyebrow">OFFICIAL DATES ONLY</p>
              <h2>Upcoming notices</h2>
            </div>
          </div>
          <div className="empty-notice">
            <Clock3 size={18} />
            <p>
              <strong>No verified notice published yet.</strong>
              Dates will include an official source and last-checked time.
            </p>
          </div>
        </div>
      </section>

      <section className="no-account-band">
        <div>
          <p className="eyebrow">NO ACCOUNT REQUIRED</p>
          <h2>Your browser is your study record.</h2>
        </div>
        <p>
          We create a random ID, not a profile. We never ask for your name, email, phone number or
          password. Clearing browser data or changing devices removes access to this history.
        </p>
      </section>
    </>
  );
}
