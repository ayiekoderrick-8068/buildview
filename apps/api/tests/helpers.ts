import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CadParseResultSchema, type CadParseResult } from '@buildview/shared';
import { buildApp } from '../src/app.ts';
import { MemoryImportRepository } from '../src/importRepositories.ts';
import { HttpCadWorker, ImportService, MemoryFileStore, type CadWorker, type ImportRepository, type WorkerResult } from '../src/imports.ts';
import type { ProjectRepository } from '../src/repository.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '../../../tests/fixtures');
export const fixtureBytes = (name: string) => readFileSync(path.join(FIXTURES, 'dxf', name));
export const goldenParse = (name: string): CadParseResult =>
  CadParseResultSchema.parse(JSON.parse(readFileSync(path.join(FIXTURES, 'parsed', `${name}.json`), 'utf8')));

/** Controllable stand-in for the Python worker. */
export class FakeWorker implements CadWorker {
  reachable = true;
  calls = 0;
  respond: (bytes: Buffer, format: 'dxf' | 'dwg') => WorkerResult = (_b, f) =>
    f === 'dwg'
      ? { ok: false, code: 'dwg_unavailable', message: 'No licensed DWG-to-DXF converter is configured.' }
      : { ok: true, result: goldenParse('house-mm') };
  async health() {
    return { reachable: this.reachable, dwgAvailable: false, dwgReason: 'No licensed DWG-to-DXF converter is configured.' };
  }
  async parse(bytes: Buffer, format: 'dxf' | 'dwg'): Promise<WorkerResult> {
    this.calls++;
    if (!this.reachable) return { ok: false, code: 'worker_unreachable', message: 'The CAD worker is not reachable. Start it and retry the import.' };
    return this.respond(bytes, format);
  }
}

export function makeApp(repo: ProjectRepository, worker: CadWorker = new FakeWorker(), importRepo: ImportRepository = new MemoryImportRepository()) {
  const files = new MemoryFileStore();
  const imports = new ImportService(importRepo, files, worker);
  const app = buildApp(repo, { imports });
  return { app, imports, files, worker };
}

/** Starts the real Python worker on a private port if its virtualenv exists. Returns null otherwise. */
export async function startRealWorker(): Promise<{ worker: HttpCadWorker; stop: () => void } | null> {
  const dir = path.resolve(here, '../../cad-worker');
  const py = path.join(dir, '.venv/bin/python');
  try {
    readFileSync(py);
  } catch {
    return null;
  }
  const port = 8199;
  const proc: ChildProcess = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], { cwd: dir, stdio: 'ignore' });
  const worker = new HttpCadWorker(`http://127.0.0.1:${port}`, 60_000);
  for (let i = 0; i < 60; i++) {
    if ((await worker.health()).reachable) return { worker, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  return null;
}
