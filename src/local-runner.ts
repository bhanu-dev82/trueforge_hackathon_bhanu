import { spawn } from 'node:child_process';
import { fixtureRoot } from './fixture-prompt.js';

export interface LocalRunResult {
  command: string;
  cwd: string;
  exitCode: number;
  output: string;
  durationMs: number;
}

/**
 * Deterministic legacy helper for the bundled fixture failure.
 * This is NOT isolation; the demo backend uses controlled-runtime selection.
 */
export function runFixtureTestLocally(timeoutMs = 60_000): Promise<LocalRunResult> {
  const cwd = fixtureRoot();
  const args = ['--test', 'tests/token_verifier.test.mjs'];
  const command = `node ${args.join(' ')}`;
  const started = Date.now();
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.TMPDIR ?? '/tmp', TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: 'C.UTF-8', CI: '1', NO_COLOR: '1',
    };
    const child = spawn(process.execPath, args, { cwd, env });
    let out = '';
    const cap = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.length > 20_000) out = out.slice(-20_000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ command, cwd, exitCode: code ?? -1, output: out, durationMs: Date.now() - started });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ command, cwd, exitCode: -1, output: String(err), durationMs: Date.now() - started });
    });
  });
}
