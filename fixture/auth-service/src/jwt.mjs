import { createHmac, timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Intentionally incomplete: signature is verified, `exp` is not.
 * The bundled test `rejects an expired JWT` fails until this checks exp.
 */
export function verify(token, secret) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) {
    return { ok: false, status: 401, reason: 'malformed' };
  }

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = encoder.encode(sig);
  const b = encoder.encode(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: 'bad_signature' };
  }

  const payload = JSON.parse(fromB64url(body));
  return { ok: true, status: 200, payload };
}
