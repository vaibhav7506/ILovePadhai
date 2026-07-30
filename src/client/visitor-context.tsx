import { categorizeDevice, categorizeReferrer } from '@shared/analytics';
import type { PageEventInput } from '@shared/visitor';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const visitorKey = 'examforge.visitor_uuid';
const sessionKey = 'examforge.session_uuid';
const consentKey = 'examforge.analytics_consent';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[4-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Registration {
  learnerNumber: number;
  totalLearners: number;
  totalVisits: number;
  visitorsToday: number;
  returningVisitors: number;
  isNewLearner: boolean;
  isNewSession: boolean;
}

type VisitorStatus = 'loading' | 'ready' | 'unavailable';

interface VisitorContextValue {
  visitorUuid: string | null;
  registration: Registration | null;
  status: VisitorStatus;
  analyticsEnabled: boolean;
  resetData: () => Promise<void>;
  setAnalyticsEnabled: (enabled: boolean) => Promise<void>;
  trackEvent: (
    eventType: PageEventInput['eventType'],
    path: string,
    examinationSlug?: string,
  ) => Promise<void>;
}

const VisitorContext = createContext<VisitorContextValue | null>(null);

function readCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${encodeURIComponent(name)}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

function getOrCreateUuid(storage: Storage, key: string, cookieValue?: string | null): string {
  const stored = storage.getItem(key);
  if (stored && uuidPattern.test(stored)) return stored;
  if (cookieValue && uuidPattern.test(cookieValue)) {
    storage.setItem(key, cookieValue);
    return cookieValue;
  }
  const created = crypto.randomUUID();
  storage.setItem(key, created);
  return created;
}

export function VisitorProvider({ children }: PropsWithChildren) {
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [status, setStatus] = useState<VisitorStatus>('loading');
  const [analyticsEnabled, setAnalyticsState] = useState(
    () => localStorage.getItem(consentKey) !== 'false',
  );

  useEffect(() => {
    const controller = new AbortController();
    const visitorUuid = getOrCreateUuid(localStorage, visitorKey, readCookie('examforge_visitor'));
    const sessionUuid = getOrCreateUuid(sessionStorage, sessionKey);
    const register = async () => {
      try {
        const response = await fetch('/api/visitors/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitorUuid,
            sessionUuid,
            landingPath: window.location.pathname,
            deviceCategory: categorizeDevice(navigator.userAgent),
            referrerCategory: categorizeReferrer(document.referrer, window.location.hostname),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Registration failed with ${String(response.status)}.`);
        }
        const result = (await response.json()) as Registration;
        setRegistration(result);
        setStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus('unavailable');
      }
    };
    void register();
    return () => {
      controller.abort();
    };
  }, []);

  const trackEvent = useCallback(
    async (eventType: PageEventInput['eventType'], path: string, examinationSlug?: string) => {
      if (!analyticsEnabled || status !== 'ready') return;
      const visitorUuid = localStorage.getItem(visitorKey);
      const sessionUuid = sessionStorage.getItem(sessionKey);
      if (!visitorUuid || !sessionUuid) return;
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventUuid: crypto.randomUUID(),
          visitorUuid,
          sessionUuid,
          eventType,
          path,
          ...(examinationSlug ? { examinationSlug } : {}),
        }),
        keepalive: true,
      });
    },
    [analyticsEnabled, status],
  );

  const setAnalyticsEnabled = useCallback(async (enabled: boolean) => {
    setAnalyticsState(enabled);
    localStorage.setItem(consentKey, String(enabled));
    const visitorUuid = localStorage.getItem(visitorKey);
    if (!visitorUuid) return;
    await fetch('/api/consent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorUuid, anonymousAnalytics: enabled }),
    });
  }, []);

  const resetData = useCallback(async () => {
    const visitorUuid = localStorage.getItem(visitorKey);
    if (visitorUuid) {
      const response = await fetch('/api/visitors/me', {
        method: 'DELETE',
        headers: {
          'x-anonymous-visitor': visitorUuid,
          'x-confirm-delete': 'DELETE',
        },
      });
      if (!response.ok) throw new Error('Data deletion was not completed.');
    }
    Object.keys(localStorage)
      .filter((key) => key.startsWith('examforge.'))
      .forEach((key) => {
        localStorage.removeItem(key);
      });
    sessionStorage.removeItem(sessionKey);
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    document.cookie = 'examforge_visitor=; Max-Age=0; Path=/; SameSite=Lax';
  }, []);

  useEffect(() => {
    if (
      !analyticsEnabled ||
      !import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN ||
      document.querySelector('[data-cf-beacon]')
    ) {
      return;
    }
    const script = document.createElement('script');
    script.defer = true;
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    script.dataset.cfBeacon = JSON.stringify({
      token: import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN,
    });
    document.body.append(script);
    return () => {
      script.remove();
    };
  }, [analyticsEnabled]);

  const value = useMemo(
    () => ({
      visitorUuid: localStorage.getItem(visitorKey),
      registration,
      status,
      analyticsEnabled,
      resetData,
      setAnalyticsEnabled,
      trackEvent,
    }),
    [analyticsEnabled, registration, resetData, setAnalyticsEnabled, status, trackEvent],
  );

  return <VisitorContext value={value}>{children}</VisitorContext>;
}

export function useVisitor(): VisitorContextValue {
  const value = useContext(VisitorContext);
  if (!value) throw new Error('useVisitor must be used inside VisitorProvider.');
  return value;
}
