import { Check, Download, HardDrive, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OfflineCatalogueItem, OfflinePracticeQuestion } from '@shared/offline';
import {
  clearOfflineStorage,
  OFFLINE_CACHE,
  offlineResultsKey,
  readDownloadedItems,
  writeDownloadedItems,
  type DownloadedItem,
} from '../pwa';

interface NoteBundle {
  kind: 'note';
  competitiveEligible: false;
  note: {
    title: string;
    subject: string;
    topic: string;
    summaryMarkdown: string;
    language: string;
  };
  citations: { label: string; sourcePage: number | null; sourceUrl: string }[];
}

interface PracticeBundle {
  kind: 'practice';
  title: string;
  competitiveEligible: false;
  integrityLabel: string;
  questions: OfflinePracticeQuestion[];
}

type OfflineBundle = NoteBundle | PracticeBundle;

export function OfflineLibraryPage() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogueItem[]>([]);
  const [downloaded, setDownloaded] = useState<DownloadedItem[]>(readDownloadedItems);
  const [active, setActive] = useState<OfflineBundle | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [message, setMessage] = useState('Checking verified downloads…');

  const downloadedUrls = useMemo(
    () => new Set(downloaded.map((item) => item.downloadUrl)),
    [downloaded],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/offline/catalogue');
        if (!response.ok) throw new Error('Catalogue unavailable');
        const body = (await response.json()) as { items: OfflineCatalogueItem[] };
        setCatalogue(body.items);
        setMessage(
          body.items.length
            ? 'Choose only the verified material you want stored on this device.'
            : 'No published, verified offline material is available yet.',
        );
      } catch {
        setMessage(
          downloaded.length
            ? 'You are offline. Your downloaded material is ready below.'
            : 'The catalogue is unavailable and this device has no downloads yet.',
        );
      }
    };
    void load();
  }, [downloaded.length]);

  const downloadItem = async (item: OfflineCatalogueItem) => {
    setMessage(`Downloading ${item.title}…`);
    try {
      const response = await fetch(item.downloadUrl);
      if (!response.ok) throw new Error('Download unavailable');
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(item.downloadUrl, response.clone());
      const next = [
        ...downloaded.filter((entry) => entry.id !== item.id),
        { ...item, downloadedAt: new Date().toISOString() },
      ];
      writeDownloadedItems(next);
      setDownloaded(next);
      setMessage(`${item.title} is available offline.`);
    } catch {
      setMessage('Download failed. Reconnect and try again.');
    }
  };

  const openItem = async (item: DownloadedItem) => {
    const cache = await caches.open(OFFLINE_CACHE);
    const response = await cache.match(item.downloadUrl, { ignoreVary: true });
    if (!response) {
      setMessage('This download is incomplete. Reconnect and download it again.');
      return;
    }
    setActive((await response.json()) as OfflineBundle);
    setAnswers({});
    setScore(null);
  };

  const submitOffline = (bundle: PracticeBundle) => {
    const correct = bundle.questions.filter(
      (question) => answers[question.id] === question.correctOptionIndex,
    ).length;
    setScore(correct);
    const prior = JSON.parse(localStorage.getItem(offlineResultsKey) ?? '[]') as unknown[];
    localStorage.setItem(
      offlineResultsKey,
      JSON.stringify([
        ...prior,
        {
          id: crypto.randomUUID(),
          title: bundle.title,
          correct,
          total: bundle.questions.length,
          completedAt: new Date().toISOString(),
          competitiveEligible: false,
        },
      ]),
    );
  };

  const clear = async () => {
    if (!window.confirm('Remove all downloaded notes, practice sets and offline results?')) return;
    await clearOfflineStorage();
    setDownloaded([]);
    setActive(null);
    setMessage('Offline storage is clear. Your online history and anonymous identity were kept.');
  };

  return (
    <section className="offline-page">
      <div className="offline-hero">
        <div>
          <p className="eyebrow">OFFLINE DESK / DEVICE STORAGE</p>
          <h1>Carry a small, verified library.</h1>
          <p>{message}</p>
        </div>
        <aside>
          <HardDrive size={22} />
          <strong>{downloaded.length} saved</strong>
          <span>Explicit downloads only. Nothing is cached as a whole question bank.</span>
        </aside>
      </div>

      <div className="offline-actions">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          <RefreshCw size={16} /> Refresh catalogue
        </button>
        <button type="button" onClick={() => void clear()}>
          <Trash2 size={16} /> Clear offline storage
        </button>
      </div>

      {catalogue.length > 0 && (
        <section className="offline-section">
          <p className="eyebrow">AVAILABLE TO DOWNLOAD</p>
          <div className="offline-grid">
            {catalogue.map((item) => (
              <article key={item.id}>
                <span>{item.kind === 'note' ? 'VERIFIED NOTE' : 'OFFLINE PRACTICE'}</span>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
                <small>
                  {item.language.toUpperCase()} · version {item.version.slice(0, 10)}
                </small>
                <button type="button" onClick={() => void downloadItem(item)}>
                  {downloadedUrls.has(item.downloadUrl) ? (
                    <Check size={16} />
                  ) : (
                    <Download size={16} />
                  )}
                  {downloadedUrls.has(item.downloadUrl) ? 'Downloaded' : 'Download'}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="offline-section">
        <p className="eyebrow">ON THIS DEVICE</p>
        {downloaded.length === 0 ? (
          <div className="honest-empty">
            <WifiOff size={22} />
            <p>Nothing downloaded yet. Connect once and choose an item from the catalogue.</p>
          </div>
        ) : (
          <div className="download-list">
            {downloaded.map((item) => (
              <button type="button" key={item.id} onClick={() => void openItem(item)}>
                <span>{item.kind}</span>
                <strong>{item.title}</strong>
                <small>Saved {new Date(item.downloadedAt).toLocaleDateString('en-IN')}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {active?.kind === 'note' && (
        <article className="offline-reader">
          <p className="eyebrow">DOWNLOADED VERIFIED NOTE</p>
          <h2>{active.note.title}</h2>
          <p className="offline-copy">{active.note.summaryMarkdown}</p>
          <h3>Official citations</h3>
          {active.citations.map((citation) => (
            <a
              key={`${citation.sourceUrl}:${String(citation.sourcePage)}`}
              href={citation.sourceUrl}
            >
              {citation.label}
              {citation.sourcePage ? ` · page ${String(citation.sourcePage)}` : ''}
            </a>
          ))}
        </article>
      )}

      {active?.kind === 'practice' && (
        <section className="offline-reader">
          <p className="eyebrow">OFFLINE SELF-ASSESSMENT</p>
          <h2>{active.title}</h2>
          <div className="offline-warning">{active.integrityLabel}</div>
          {active.questions.map((question, index) => (
            <fieldset key={question.id}>
              <legend>
                {index + 1}. {question.questionText}
              </legend>
              {question.options.map((option) => (
                <label key={option.optionIndex}>
                  <input
                    checked={answers[question.id] === option.optionIndex}
                    name={question.id}
                    type="radio"
                    onChange={() => {
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: option.optionIndex,
                      }));
                    }}
                  />
                  {option.optionText}
                </label>
              ))}
              {score !== null && (
                <small>
                  Correct answer: {String.fromCharCode(65 + question.correctOptionIndex)}
                  {question.explanationMarkdown ? ` · ${question.explanationMarkdown}` : ''}
                </small>
              )}
            </fieldset>
          ))}
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              submitOffline(active);
            }}
          >
            Check locally
          </button>
          {score !== null && (
            <p role="status">
              Local score: {score}/{active.questions.length}. This result was not sent to ExamForge.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
