import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type RuntimeMode = 'container' | 'worktree' | 'process';

export interface RuntimeResult {
  command: string;
  cwd: string;
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  runtime: { mode: RuntimeMode; isolated: boolean; detail: string };
}

interface ExecResult extends Omit<RuntimeResult, 'runtime'> {}

const OUTPUT_LIMIT = 40_000;
const SAFE_EXECUTABLES = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'python', 'python3', 'pytest', 'go', 'cargo', 'dotnet', 'mvn', 'gradle']);

function minimalEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: os.tmpdir(),
    TMPDIR: os.tmpdir(),
    LANG: 'C.UTF-8',
    CI: '1',
    NO_COLOR: '1',
  };
}

function exec(file: string, args: string[], cwd: string, timeoutMs: number, env = minimalEnvironment()): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let output = '';
    const child = spawn(file, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command: [file, ...args].join(' '), cwd, exitCode, output, durationMs: Date.now() - started, timedOut, truncated });
    };
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > OUTPUT_LIMIT) {
        truncated = true;
        output = `[output truncated to ${OUTPUT_LIMIT} bytes]\n${output.slice(-OUTPUT_LIMIT)}`;
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      output += String(error);
      finish(-1);
    });
    child.once('close', (code, signal) => {
      if (signal) output += `\n[terminated: ${signal}]`;
      finish(code ?? -1);
    });
  });
}

export function parseCommand(command: string): [string, ...string[]] {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) ?? [];
  if (!tokens.length) throw new Error('test command is empty');
  if (/[;&|`$<>\n\r\\]/.test(command)) throw new Error('shell operators are not allowed in test commands');
  const executable = path.basename(tokens[0] ?? '');
  if (!SAFE_EXECUTABLES.has(executable)) throw new Error(`test executable is not allowlisted: ${executable}`);
  return tokens as [string, ...string[]];
}

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function safeCwd(projectRoot: string, repositoryPath: string): Promise<string> {
  const root = await realpath(projectRoot);
  const candidate = await realpath(path.resolve(root, repositoryPath));
  if (!within(root, candidate)) throw new Error('repositoryPath must stay inside the project');
  await access(candidate);
  return candidate;
}

async function rootlessContainer(engine: 'podman' | 'docker', cwd: string): Promise<boolean> {
  const probeArgs = engine === 'podman' ? ['info', '--format', '{{.Host.Security.Rootless}}'] : ['info', '--format', '{{json .SecurityOptions}}'];
  const probe = await exec(engine, probeArgs, cwd, 3_000);
  if (probe.exitCode !== 0) return false;
  return engine === 'podman' ? probe.output.trim() === 'true' : /rootless/i.test(probe.output);
}

async function tryContainer(engine: 'podman' | 'docker', cwd: string, file: string, args: string[], timeoutMs: number): Promise<RuntimeResult | undefined> {
  if (!(await rootlessContainer(engine, cwd))) return undefined;
  const image = process.env.CI_SURGEON_CONTAINER_IMAGE?.trim();
  if (!image) return undefined;
  const containerArgs = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '2', '--userns', 'keep-id', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '-v', `${cwd}:/workspace:ro`, '-w', '/workspace', image, file, ...args];
  const result = await exec(engine, containerArgs, cwd, timeoutMs);
  return { ...result, runtime: { mode: 'container', isolated: true, detail: `Rootless ${engine} container; read-only workspace, network disabled, limits applied, removed on exit` } };
}

export async function runControlled(projectRoot: string, repositoryPath: string, command: string, timeoutMs = 60_000): Promise<RuntimeResult> {
  const cwd = await safeCwd(projectRoot, repositoryPath);
  const [file, ...args] = parseCommand(command);

  for (const engine of ['podman', 'docker'] as const) {
    const result = await tryContainer(engine, cwd, file, args, timeoutMs);
    if (result) return result;
  }

  const probe = await exec('git', ['rev-parse', '--show-toplevel'], cwd, 5_000);
  if (probe.exitCode === 0) {
    const gitRoot = probe.output.trim().split('\n').at(-1);
    const root = await realpath(projectRoot);
    if (gitRoot && within(root, gitRoot)) {
      const temporary = await mkdtemp(path.join(os.tmpdir(), 'ci-surgeon-'));
      const worktree = path.join(temporary, 'worktree');
      const added = await exec('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], gitRoot, 20_000);
      if (added.exitCode === 0) {
        try {
          const worktreeCwd = path.join(worktree, path.relative(gitRoot, cwd));
          const result = await exec(file, args, worktreeCwd, timeoutMs);
          return { ...result, runtime: { mode: 'worktree', isolated: true, detail: 'Ephemeral detached git worktree; bounded no-shell process; removed after reproduction' } };
        } finally {
          await exec('git', ['worktree', 'remove', '--force', worktree], gitRoot, 20_000);
          await rm(temporary, { recursive: true, force: true });
        }
      }
      await rm(temporary, { recursive: true, force: true });
    }
  }

  const result = await exec(file, args, cwd, timeoutMs);
  return { ...result, runtime: { mode: 'process', isolated: false, detail: 'Bounded direct process fallback; no shell, allowlisted executable, minimal environment, output cap, and timeout' } };
}
