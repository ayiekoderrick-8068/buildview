import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CadParseResultSchema, type Capabilities, type CadParseResult, type ImportJob } from '@buildview/shared';

export const MAX_UPLOAD_BYTES = Number(process.env['MAX_UPLOAD_BYTES'] ?? 25 * 1024 * 1024);

// ---------------------------------------------------------------- upload checks

export type UploadFormat = 'dxf' | 'dwg';

export interface UploadCheck {
  ok: boolean;
  format?: UploadFormat;
  code?: string;
  message?: string;
}

/** Filename -> a storage/display-safe name. Never used as a path; only as a label. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'drawing';
  const cleaned = base.normalize('NFKD').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return cleaned || 'drawing';
}

/**
 * Accepts only genuine-looking DXF or DWG files: the extension must be .dxf/.dwg AND the content
 * signature must match. DXF: ASCII group-code header ("0\nSECTION") or the binary-DXF sentinel.
 * DWG: "AC10xx" version magic. A renamed executable or script fails the signature check.
 */
export function checkUpload(fileName: string, bytes: Buffer): UploadCheck {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.dxf' && ext !== '.dwg') return { ok: false, code: 'unsupported_type', message: 'Only .dxf and .dwg files can be uploaded.' };
  if (bytes.length === 0) return { ok: false, code: 'empty_file', message: 'The file is empty.' };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, code: 'too_large', message: `The file exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit.` };
  const head = bytes.subarray(0, 64).toString('latin1');
  if (ext === '.dwg') {
    return /^AC10\d\d/.test(head)
      ? { ok: true, format: 'dwg' }
      : { ok: false, code: 'bad_signature', message: 'The file does not have a DWG signature (expected AC10xx).' };
  }
  const isBinaryDxf = head.startsWith('AutoCAD Binary DXF');
  const isAsciiDxf = /^\s*0\s*\r?\n\s*(SECTION|COMMENT)/.test(head) || /^\s*999\s*\r?\n/.test(head);
  return isBinaryDxf || isAsciiDxf
    ? { ok: true, format: 'dxf' }
    : { ok: false, code: 'bad_signature', message: 'The file does not look like a DXF drawing (unexpected content).' };
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- file storage (private)

export interface FileStore {
  save(projectId: string, sourceId: string, ext: string, bytes: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
}

/** Files live outside any web root and are only reachable through the API. Mode 0600. */
export class DiskFileStore implements FileStore {
  constructor(private readonly root: string = process.env['UPLOAD_DIR'] ?? path.resolve('../../.data/uploads')) {}
  async save(projectId: string, sourceId: string, ext: string, bytes: Buffer) {
    const dir = path.join(this.root, projectId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const rel = path.join(projectId, `${sourceId}${ext}`); // server-generated name only
    await writeFile(path.join(this.root, rel), bytes, { mode: 0o600, flag: 'wx' });
    return rel;
  }
  async read(storagePath: string) {
    const full = path.resolve(this.root, storagePath);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage path');
    return readFile(full);
  }
}

export class MemoryFileStore implements FileStore {
  files = new Map<string, Buffer>();
  async save(projectId: string, sourceId: string, ext: string, bytes: Buffer) {
    const key = `${projectId}/${sourceId}${ext}`;
    this.files.set(key, Buffer.from(bytes));
    return key;
  }
  async read(storagePath: string) {
    const b = this.files.get(storagePath);
    if (!b) throw new Error('not found');
    return b;
  }
}

// ---------------------------------------------------------------- worker client

export type WorkerResult = { ok: true; result: CadParseResult } | { ok: false; code: string; message: string };

export interface CadWorker {
  health(): Promise<{ reachable: boolean; dwgAvailable: boolean; dwgReason: string | null }>;
  parse(bytes: Buffer, format: UploadFormat): Promise<WorkerResult>;
}

export class HttpCadWorker implements CadWorker {
  constructor(
    private readonly baseUrl: string = process.env['CAD_WORKER_URL'] ?? 'http://127.0.0.1:8100',
    private readonly timeoutMs = 60_000,
  ) {}

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      const j = (await res.json()) as { dwg?: { available: boolean; reason: string | null } };
      return { reachable: res.ok, dwgAvailable: !!j.dwg?.available, dwgReason: j.dwg?.reason ?? null };
    } catch {
      return { reachable: false, dwgAvailable: false, dwgReason: 'The CAD worker is not running.' };
    }
  }

  async parse(bytes: Buffer, format: UploadFormat): Promise<WorkerResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/parse?format=${format}`, {
        method: 'POST',
        body: new Uint8Array(bytes),
        headers: { 'content-type': 'application/octet-stream' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { ok: false, code: 'worker_unreachable', message: 'The CAD worker is not reachable. Start it and retry the import.' };
    }
    let body: { ok?: boolean; code?: string; message?: string; result?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, code: 'worker_error', message: 'The CAD worker returned an unreadable response.' };
    }
    if (!body.ok) return { ok: false, code: body.code ?? 'worker_error', message: body.message ?? 'The CAD worker rejected the file.' };
    const parsed = CadParseResultSchema.safeParse(body.result);
    if (!parsed.success) return { ok: false, code: 'worker_contract', message: 'The CAD worker returned data that does not match the expected format.' };
    return { ok: true, result: parsed.data };
  }
}

// ---------------------------------------------------------------- repository + service

export interface SourceRecord {
  id: string;
  projectId: string;
  originalName: string;
  safeName: string;
  format: UploadFormat;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
}

export interface ImportRepository {
  createSourceWithJob(src: Omit<SourceRecord, 'id'>): Promise<ImportJob>;
  /** Starts a new attempt for an existing source. */
  createJobForSource(sourceId: string): Promise<ImportJob | null>;
  getImport(jobId: string): Promise<ImportJob | null>;
  getSource(sourceId: string): Promise<SourceRecord | null>;
  sourceForJob(jobId: string): Promise<SourceRecord | null>;
  listImports(projectId: string): Promise<ImportJob[]>;
  markRunning(jobId: string): Promise<void>;
  finish(jobId: string, outcome: { result: CadParseResult } | { errorCode: string; errorMessage: string }): Promise<void>;
}

/** In-process job runner with bounded concurrency. Jobs survive in the database; a restart leaves them "queued"/"running" until retried. */
export class ImportService {
  private active = 0;
  private waiting: Array<() => void> = [];
  private readonly pending = new Set<Promise<void>>();

  constructor(
    readonly repo: ImportRepository,
    readonly files: FileStore,
    readonly worker: CadWorker,
    private readonly maxConcurrent = 2,
  ) {}

  /** Stores the upload and queues a background job. Returns immediately with the queued job. */
  async submit(projectId: string, originalName: string, bytes: Buffer, format: UploadFormat): Promise<ImportJob> {
    const id = randomUUID();
    const storagePath = await this.files.save(projectId, id, `.${format}`, bytes);
    const job = await this.repo.createSourceWithJob({ projectId, originalName, safeName: safeFileName(originalName), format, sizeBytes: bytes.length, sha256: sha256(bytes), storagePath });
    this.run(job.id);
    return job;
  }

  async retry(jobId: string): Promise<ImportJob | null> {
    const src = await this.repo.sourceForJob(jobId);
    if (!src) return null;
    const job = await this.repo.createJobForSource(src.id);
    if (job) this.run(job.id);
    return job;
  }

  /** Test helper: resolves when all queued work finished. */
  async idle() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private run(jobId: string) {
    const p = this.execute(jobId).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  private async execute(jobId: string) {
    if (this.active >= this.maxConcurrent) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      await this.repo.markRunning(jobId);
      const src = await this.repo.sourceForJob(jobId);
      if (!src) return;
      let bytes: Buffer;
      try {
        bytes = await this.files.read(src.storagePath);
      } catch {
        await this.repo.finish(jobId, { errorCode: 'file_missing', errorMessage: 'The stored drawing could not be read.' });
        return;
      }
      const out = await this.worker.parse(bytes, src.format);
      await this.repo.finish(jobId, out.ok ? { result: out.result } : { errorCode: out.code, errorMessage: out.message });
    } catch (e) {
      await this.repo.finish(jobId, { errorCode: 'internal_error', errorMessage: e instanceof Error ? e.message : 'Import failed' }).catch(() => undefined);
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  async capabilities(): Promise<Capabilities> {
    const h = await this.worker.health();
    return {
      dxf: h.reachable,
      dwg: h.reachable && h.dwgAvailable,
      dwgReason: h.reachable ? h.dwgReason : 'The CAD worker is not running, so no drawings can be processed.',
      malwareScanning: false,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    };
  }
}
