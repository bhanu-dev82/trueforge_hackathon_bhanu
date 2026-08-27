import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { InvestigationCase } from './investigation.js';

const RUN_ID = /^run_[0-9a-f-]+$/i;

export class CaseStore {
  constructor(private readonly root = path.resolve('.ci-surgeon/runs')) {}

  async save(run: InvestigationCase): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const file = this.file(run.id);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  }

  async load(id: string): Promise<InvestigationCase | undefined> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as InvestigationCase;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private file(id: string): string {
    if (!RUN_ID.test(id)) throw new Error('invalid run id');
    return path.join(this.root, `${id}.json`);
  }
}
