import { attemptTokenPayloadSchema, type AttemptTokenPayload } from './attempt';

const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signAttemptToken(
  payload: AttemptTokenPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await keyFromSecret(secret),
    encoder.encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAttemptToken(
  token: string,
  secret: string,
): Promise<AttemptTokenPayload | null> {
  const [payloadPart, signaturePart, extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await keyFromSecret(secret),
      decodeBase64Url(signaturePart),
      encoder.encode(payloadPart),
    );
    if (!valid) return null;
    const decoded = new TextDecoder().decode(decodeBase64Url(payloadPart));
    return attemptTokenPayloadSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    return null;
  }
}
