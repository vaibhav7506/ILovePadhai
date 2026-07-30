import '@fontsource/archivo/latin-600.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { VisitorProvider } from './visitor-context';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root was not found.');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <VisitorProvider>
        <App />
      </VisitorProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  const warmApplicationShell = async (registration: ServiceWorkerRegistration) => {
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) return;
    const urls = [
      window.location.href,
      ...performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => new URL(url).origin === window.location.origin),
    ];
    const channel = new MessageChannel();
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 5000);
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      worker.postMessage({ type: 'CACHE_SHELL', urls }, [channel.port2]);
    });
  };

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async (registration) => {
      await warmApplicationShell(registration);
      window.setInterval(() => void registration.update(), 60 * 60 * 1000);
    });
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    const message: unknown = event.data;
    if (
      typeof message === 'object' &&
      message !== null &&
      Reflect.get(message, 'type') === 'EXAMFORGE_SYNC'
    ) {
      window.dispatchEvent(new Event('online'));
    }
  });
}
