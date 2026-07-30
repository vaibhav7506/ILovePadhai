import { Download, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
    };
    const onOffline = () => {
      setOnline(false);
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstall);

    void navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) setUpdateReady(true);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    });
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstall);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const update = async () => {
    const registration = await navigator.serviceWorker.ready;
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  if (online && !installPrompt && !updateReady) return null;
  return (
    <aside className={`pwa-status ${online ? '' : 'offline'}`} aria-live="polite">
      {!online && (
        <span>
          <WifiOff size={16} /> Offline mode — downloaded material remains available
        </span>
      )}
      {installPrompt && (
        <button type="button" onClick={() => void install()}>
          <Download size={15} /> Install app
        </button>
      )}
      {updateReady && (
        <button type="button" onClick={() => void update()}>
          <RefreshCw size={15} /> Update ready
        </button>
      )}
    </aside>
  );
}
