import { useEffect, useRef } from 'react';

interface TurnstileApi {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      sitekey: string;
      theme: 'auto';
    },
  ): string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('[data-examforge-turnstile]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not initialise.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener(
      'error',
      () => {
        reject(new Error('Turnstile could not be loaded.'));
      },
      { once: true },
    );
    if (!existing) {
      script.async = true;
      script.defer = true;
      script.dataset.examforgeTurnstile = 'true';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      document.head.append(script);
    }
  });
  return scriptPromise;
}

interface TurnstileWidgetProps {
  action: 'register' | 'generate' | 'doubt';
  onError?: () => void;
  onToken: (token: string | undefined) => void;
  resetKey?: number;
}

export function TurnstileWidget({ action, onError, onToken, resetKey = 0 }: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const onTokenRef = useRef(onToken);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  onErrorRef.current = onError;
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let disposed = false;
    let widgetId: string | undefined;
    const mount = async () => {
      try {
        const turnstile = await loadTurnstile();
        if (disposed || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          callback: (token) => {
            onTokenRef.current(token);
          },
          'expired-callback': () => {
            onTokenRef.current(undefined);
          },
          'error-callback': () => {
            onTokenRef.current(undefined);
            onErrorRef.current?.();
          },
        });
      } catch {
        if (!disposed) onErrorRef.current?.();
      }
    };
    void mount();
    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, resetKey, siteKey]);

  if (!siteKey) return null;
  return <div className="turnstile-widget" data-action="turnstile-spin-v1" ref={container} />;
}

export const turnstileEnabled = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim());
