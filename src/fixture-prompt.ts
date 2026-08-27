import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function fixtureRoot(): string {
  const fromSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixture/auth-service');
  const fromCwd = path.resolve(process.cwd(), 'fixture/auth-service');
  if (fs.existsSync(path.join(fromSrc, 'src/jwt.mjs'))) {
    return fromSrc;
  }
  return fromCwd;
}

export function fixtureFailurePrompt(): string {
  const root = fixtureRoot();
  const source = fs.readFileSync(path.join(root, 'src/jwt.mjs'), 'utf8');
  const test = fs.readFileSync(path.join(root, 'tests/token_verifier.test.mjs'), 'utf8');

  return `CI BUILD FAILURE REPORT
Repository: fixture/auth-service (bundled with this project; sandbox-local, no GitHub login required)
Command: node --test tests/token_verifier.test.mjs
Working directory: ${root}

FAIL tests/token_verifier.test.mjs
  TokenVerifier › rejects an expired JWT
    AssertionError: expected status 401, received 200
      at tests/token_verifier.test.mjs (expired token case)

Source (src/jwt.mjs):
\`\`\`js
${source}
\`\`\`

Test (tests/token_verifier.test.mjs):
\`\`\`js
${test}
\`\`\`

Do the Hunter → Surgeon → Insurance pipeline. Reproduce with the test command above. The bug is that verify() never checks payload.exp. Search Exa for JWT exp claim verification if needed. Draft a minimal patch. Write the regression test. Pause for approval before applying any write.
`;
}
