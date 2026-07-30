import { useState } from 'react';
import { useVisitor } from '../visitor-context';

export function PrivacyPage() {
  const { analyticsEnabled, resetData, setAnalyticsEnabled } = useVisitor();
  const [confirmation, setConfirmation] = useState('');
  const [resetStatus, setResetStatus] = useState('');

  return (
    <section className="simple-page privacy-page">
      <p className="eyebrow">PRIVACY / PLAIN LANGUAGE</p>
      <h1>Your preparation does not need a personal account.</h1>
      <p className="lede">
        ExamForge uses a random browser identifier to remember progress and count anonymous
        learners. It does not request your name, email, phone number or password.
      </p>
      <div className="privacy-grid">
        <article>
          <h2>What is stored</h2>
          <p>
            A random UUID, a sequential learner number, visit times, broad device category,
            attempts, scores, study settings and your analytics preference.
          </p>
        </article>
        <article>
          <h2>What is not stored</h2>
          <p>
            No full IP address, raw browser fingerprint, personal contact details or account
            credentials are used as permanent identity.
          </p>
        </article>
        <article>
          <h2>Browser-bound history</h2>
          <p>
            Attempts, scores, study settings and your optional public nickname attach only to this
            browser’s random identity. A different device receives a different identity.
          </p>
        </article>
        <article>
          <h2>Public information</h2>
          <p>
            Aggregate learner totals are public. A nickname appears only when you opt into a
            leaderboard; the underlying UUID is never exposed.
          </p>
        </article>
      </div>
      <div className="consent-control">
        <div>
          <h2>Anonymous analytics</h2>
          <p>Help us understand page drop-off and feature use without personal details.</p>
        </div>
        <button
          className={analyticsEnabled ? 'toggle active' : 'toggle'}
          type="button"
          role="switch"
          aria-checked={analyticsEnabled}
          onClick={() => void setAnalyticsEnabled(!analyticsEnabled)}
        >
          <span aria-hidden="true" />
          {analyticsEnabled ? 'Enabled' : 'Opted out'}
        </button>
      </div>
      <div className="delete-control">
        <div>
          <p className="eyebrow">RESET MY DATA</p>
          <h2>Delete this browser’s ExamForge history</h2>
          <p>
            This permanently deletes the anonymous identity and its attempts, responses, scores,
            reports, study plan, nickname and analytics events. It also clears downloaded material
            from this device. Type <strong>DELETE</strong> to confirm.
          </p>
        </div>
        <label>
          Confirmation
          <input
            autoComplete="off"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            placeholder="Type DELETE"
          />
        </label>
        <button
          className="danger-button"
          disabled={confirmation !== 'DELETE'}
          type="button"
          onClick={() => {
            setResetStatus('Deleting…');
            void resetData()
              .then(() => {
                setResetStatus('Deleted. Reloading with a new anonymous identity…');
                window.location.assign('/');
              })
              .catch(() => {
                setResetStatus('Deletion could not be completed. Please try again.');
              });
          }}
        >
          Reset my data
        </button>
        {resetStatus && <p role="status">{resetStatus}</p>}
      </div>
    </section>
  );
}
