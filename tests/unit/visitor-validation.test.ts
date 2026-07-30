import { visitorRegistrationSchema } from '@shared/visitor';
import { describe, expect, it } from 'vitest';

describe('visitor registration validation', () => {
  const validInput = {
    visitorUuid: 'd76cb52c-6f7f-4f22-a4ba-506f414d4b6b',
    sessionUuid: '8f9552f2-7024-44e6-b47c-50445a595277',
    landingPath: '/',
    deviceCategory: 'mobile',
    referrerCategory: 'direct',
  };

  it('accepts a privacy-minimal registration payload', () => {
    expect(visitorRegistrationSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects invalid IDs and full external landing URLs', () => {
    expect(
      visitorRegistrationSchema.safeParse({ ...validInput, visitorUuid: 'not-an-id' }).success,
    ).toBe(false);
    expect(
      visitorRegistrationSchema.safeParse({
        ...validInput,
        landingPath: 'https://example.com/private',
      }).success,
    ).toBe(false);
  });
});
