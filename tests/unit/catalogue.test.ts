import { examinations } from '@shared/catalogue';
import { describe, expect, it } from 'vitest';

describe('examination catalogue', () => {
  it('keeps the two requested levels data-driven', () => {
    expect(examinations.filter((exam) => exam.level === 'secondary')).toHaveLength(3);
    expect(examinations.filter((exam) => exam.level === 'graduate')).toHaveLength(3);
  });

  it('does not represent unverified content as available', () => {
    expect(examinations.every((exam) => exam.status === 'verification')).toBe(true);
  });
});
