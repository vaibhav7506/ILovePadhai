import { categorizeDevice, categorizeReferrer, isObviousCrawler } from '@shared/analytics';
import { describe, expect, it } from 'vitest';

describe('anonymous analytics classification', () => {
  it('rejects obvious crawler and monitoring user agents', () => {
    expect(isObviousCrawler('Googlebot/2.1')).toBe(true);
    expect(isObviousCrawler('UptimeRobot/2.0')).toBe(true);
    expect(
      isObviousCrawler(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
      ),
    ).toBe(false);
  });

  it('uses only a broad device category', () => {
    expect(categorizeDevice('Mozilla/5.0 (iPhone) Mobile Safari')).toBe('mobile');
    expect(categorizeDevice('Mozilla/5.0 (iPad) Safari')).toBe('tablet');
    expect(categorizeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome')).toBe('desktop');
  });

  it('reduces referrers to non-identifying categories', () => {
    expect(categorizeReferrer('', 'examforge.test')).toBe('direct');
    expect(categorizeReferrer('https://www.google.com/search?q=ssc', 'examforge.test')).toBe(
      'search',
    );
    expect(categorizeReferrer('https://examforge.test/privacy', 'examforge.test')).toBe('internal');
    expect(categorizeReferrer('https://example.org/a/private/path', 'examforge.test')).toBe(
      'referral',
    );
  });
});
