import type { DeviceCategory, ReferrerCategory } from './visitor';

const botPattern =
  /bot|crawler|spider|headless|lighthouse|monitor|uptime|preview|facebookexternalhit|slurp/i;

export function isObviousCrawler(userAgent: string): boolean {
  return userAgent.length < 8 || botPattern.test(userAgent);
}

export function categorizeDevice(userAgent: string): DeviceCategory {
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return 'tablet';
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return 'mobile';
  if (userAgent.length > 0) return 'desktop';
  return 'unknown';
}

export function categorizeReferrer(referrer: string, currentHost: string): ReferrerCategory {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === currentHost.toLowerCase()) return 'internal';
    if (/google|bing|duckduckgo|yahoo/.test(host)) return 'search';
    if (/facebook|instagram|linkedin|reddit|t\.co|twitter|x\.com/.test(host)) return 'social';
    return 'referral';
  } catch {
    return 'unknown';
  }
}
