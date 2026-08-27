const SECRET_ASSIGNMENT = /((?:api[_-]?key|token|secret|authorization|cookie)\s*[:=]\s*)([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;

export function redact(value: string, secrets: Array<string | undefined> = []): string {
  let output = value;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) output = output.split(secret).join('[REDACTED]');
  }
  return output.replace(BEARER, 'Bearer [REDACTED]').replace(SECRET_ASSIGNMENT, '$1[REDACTED]');
}
