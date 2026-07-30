import { ClipboardCheck, LockKeyhole, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { PwaStatus } from './components/PwaStatus';
import { useVisitor } from './visitor-context';

const productName = import.meta.env.VITE_PRODUCT_NAME ?? 'ExamForge';
const HomePage = lazy(() =>
  import('./pages/HomePage').then((module) => ({ default: module.HomePage })),
);
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage })),
);
const PracticePage = lazy(() =>
  import('./pages/PracticePage').then((module) => ({ default: module.PracticePage })),
);
const LeaderboardsPage = lazy(() =>
  import('./pages/LeaderboardsPage').then((module) => ({ default: module.LeaderboardsPage })),
);
const StudyPage = lazy(() =>
  import('./pages/StudyPage').then((module) => ({ default: module.StudyPage })),
);
const AttemptPage = lazy(() =>
  import('./pages/AttemptPage').then((module) => ({ default: module.AttemptPage })),
);
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })),
);
const OfflineLibraryPage = lazy(() =>
  import('./pages/OfflineLibraryPage').then((module) => ({
    default: module.OfflineLibraryPage,
  })),
);

function Shell() {
  const location = useLocation();
  const { registration, status, trackEvent } = useVisitor();

  useEffect(() => {
    void trackEvent('page_view', location.pathname);
  }, [location.pathname, trackEvent]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/" aria-label={`${productName} home`}>
            <span className="brand-mark" aria-hidden="true">
              <ClipboardCheck size={20} />
            </span>
            <span>{productName}</span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link to="/">Examinations</Link>
            <Link to="/library">Verified library</Link>
            <Link to="/practice">Practice</Link>
            <Link to="/leaderboards">Leaderboards</Link>
            <Link to="/study">Study plan</Link>
            <Link to="/offline">Offline</Link>
            <Link to="/privacy">Privacy</Link>
          </nav>
          <div className="header-footfall" aria-live="polite">
            <span className={`status-dot ${status}`} aria-hidden="true" />
            {status === 'ready' && registration
              ? `${registration.totalLearners.toLocaleString('en-IN')} anonymous ${
                  registration.totalLearners === 1 ? 'learner has' : 'learners have'
                } visited`
              : status === 'loading'
                ? 'Counting learners…'
                : 'Count unavailable'}
          </div>
        </div>
      </header>
      <PwaStatus />

      <main id="main-content">
        <Suspense
          fallback={
            <section className="simple-page" aria-live="polite">
              <p className="eyebrow">OPENING DESK</p>
              <h1>Loading only what this page needs…</h1>
            </section>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/leaderboards" element={<LeaderboardsPage />} />
            <Route path="/study" element={<StudyPage />} />
            <Route path="/offline" element={<OfflineLibraryPage />} />
            <Route path="/attempts/:id" element={<AttemptPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route
              path="*"
              element={
                <section className="simple-page">
                  <p className="eyebrow">404 / NOT FOUND</p>
                  <h1>This desk is empty.</h1>
                  <p>The page you requested does not exist.</p>
                  <Link className="text-link" to="/">
                    Return to the examination desk
                  </Link>
                </section>
              }
            />
          </Routes>
        </Suspense>
      </main>

      <footer className="site-footer">
        <div>
          <strong>{productName}</strong>
          <p>Verified practice, without collecting your personal details.</p>
        </div>
        <div className="footer-trust">
          <span>
            <ShieldCheck size={16} /> Anonymous by design
          </span>
          <span>
            <LockKeyhole size={16} /> No sign-in
          </span>
        </div>
        <div className="footer-count" aria-live="polite">
          {status === 'ready' && registration
            ? `${registration.totalLearners.toLocaleString('en-IN')} anonymous learners visited`
            : status === 'loading'
              ? 'Learner count loading…'
              : 'Learner count unavailable'}
        </div>
      </footer>
    </div>
  );
}

export function App() {
  return <Shell />;
}
