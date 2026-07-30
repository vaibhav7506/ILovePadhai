import { EyeOff, Medal, Scale, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

const views = [
  ['First attempt', 'An immutable first eligible result for each learner.'],
  ['Personal best', 'Best score, then accuracy, then completion time.'],
  ['Latest', 'The most recent eligible paper for each learner.'],
  ['Weekly', 'Eligible results submitted during the last seven days.'],
  ['All time', 'Best legitimate result within one exact comparison group.'],
];

export function LeaderboardsPage() {
  return (
    <div className="leaderboard-page">
      <header className="leaderboard-hero">
        <div>
          <p className="eyebrow">PHASE 4 / HONEST RANKING</p>
          <h1>A leaderboard only when the papers truly match.</h1>
          <p>
            ExamForge compares the same examination, paper version, question set, timer, and marking
            scheme. No seeded names. No fabricated rank.
          </p>
          <Link className="primary-button" to="/practice">
            Start a verified paper
          </Link>
        </div>
        <aside>
          <Medal aria-hidden="true" size={35} />
          <strong>Waiting for comparable results</strong>
          <p>
            Public rows appear only after real learners opt in. Until then, this table stays
            intentionally empty.
          </p>
        </aside>
      </header>

      <section className="leaderboard-principles">
        <article>
          <Scale aria-hidden="true" size={24} />
          <h2>Exact comparability</h2>
          <p>A server-signed fingerprint locks the question set, timing, pattern, and marks.</p>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" size={24} />
          <h2>Integrity screened</h2>
          <p>Suspicious timing and excessive answer mutation are flagged outside ranked results.</p>
        </article>
        <article>
          <EyeOff aria-hidden="true" size={24} />
          <h2>Private by default</h2>
          <p>Learners choose whether to publish a filtered nickname; no real name is required.</p>
        </article>
      </section>

      <section className="leaderboard-empty">
        <div className="leaderboard-tabs" aria-label="Leaderboard views">
          {views.map(([name, description], index) => (
            <button aria-describedby={`view-${String(index)}`} key={name} type="button">
              {name}
              <small id={`view-${String(index)}`}>{description}</small>
            </button>
          ))}
        </div>
        <div className="empty-ranking">
          <span>RANK</span>
          <span>LEARNER</span>
          <span>SCORE</span>
          <span>ACCURACY</span>
          <span>TIME</span>
          <p>No legitimate comparable entries yet.</p>
        </div>
      </section>
    </div>
  );
}
