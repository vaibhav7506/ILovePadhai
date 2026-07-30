import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { RuntimeVariables } from './env';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function equalSecrets(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  let difference = 0;
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  for (let index = 0; index < aBytes.length; index += 1) {
    difference |= (aBytes[index] ?? 0) ^ (bBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function authenticateAdmin(
  request: Request,
  variables: RuntimeVariables,
  localToken?: string,
): Promise<string | null> {
  if (variables.ADMIN_MODE === 'local') {
    const supplied = request.headers.get('x-local-admin-token');
    if (!localToken || !supplied || !(await equalSecrets(supplied, localToken))) return null;
    return 'local-admin';
  }

  const assertion = request.headers.get('cf-access-jwt-assertion');
  if (!assertion || !variables.ACCESS_TEAM_DOMAIN || !variables.ACCESS_AUD) return null;
  try {
    const issuer = variables.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
    let keySet = keySets.get(issuer);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(issuer, keySet);
    }
    const { payload } = await jwtVerify(assertion, keySet, {
      audience: variables.ACCESS_AUD,
      issuer,
    });
    return typeof payload.sub === 'string' ? payload.sub : 'access-reviewer';
  } catch {
    return null;
  }
}
