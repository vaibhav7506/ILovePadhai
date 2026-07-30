import type { RuntimeVariables } from './env';

const siteverifyResponseSchema = {
  isValid(value: unknown): value is { success: boolean; hostname?: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'success' in value &&
      typeof value.success === 'boolean'
    );
  },
};

export async function verifyTurnstile(
  token: string | undefined,
  variables: RuntimeVariables,
): Promise<boolean> {
  if (variables.TURNSTILE_MODE === 'off') return true;
  if (!token || !variables.TURNSTILE_SECRET_KEY) return false;

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: variables.TURNSTILE_SECRET_KEY,
      response: token,
      idempotency_key: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return false;

  const result: unknown = await response.json();
  if (!siteverifyResponseSchema.isValid(result) || !result.success) return false;
  if (!result.hostname) return false;

  const allowedHostnames = new Set(
    variables.TURNSTILE_HOSTNAMES.split(',').map((hostname) => hostname.trim()),
  );
  return allowedHostnames.has(result.hostname);
}
