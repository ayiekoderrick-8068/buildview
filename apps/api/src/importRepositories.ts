import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CadParseResultSchema, type CadParseResult, type ImportJob } from '@buildview/shared';
import type { ImportRepository, SourceRecord, UploadFormat } from './imports.ts';

type JobRow = {
  id: string;
  sourceId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  result: Prisma.JsonValue | null;
  createdAt: Date;
  finishedAt: Date | null;
  source: { projectId: string; safeName: string; format: string; sha256: string; sizeBytes: number };
};

const toDto = (r: JobRow, withResult: boolean): ImportJob => ({
  id: r.id,
  sourceId: r.sourceId,
  projectId: r.source.projectId,
  status: r.status as ImportJob['status'],
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  fileName: r.source.safeName,
  format: r.source.format as UploadFormat,
  sha256: r.source.sha256,
  sizeBytes: r.source.sizeBytes,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  result: withResult && r.result ? CadParseResultSchema.parse(r.result) : null,
});

export class PrismaImportRepository implements ImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private include = { source: { select: { projectId: true, safeName: true, format: true, sha256: true, sizeBytes: true } } } as const;

  async createSourceWithJob(src: Omit<SourceRecord, 'id'>) {
    const row = await this.prisma.importJob.create({
      data: {
        source: { create: { projectId: src.projectId, originalName: src.originalName.slice(0, 255), safeName: src.safeName, format: src.format, sizeBytes: src.sizeBytes, sha256: src.sha256, storagePath: src.storagePath } },
      },
      include: this.include,
    });
    return toDto(row, false);
  }

  async createJobForSource(sourceId: string) {
    const prev = await this.prisma.importJob.count({ where: { sourceId } });
    if (!(await this.prisma.cadSource.findUnique({ where: { id: sourceId }, select: { id: true } }))) return null;
    const row = await this.prisma.importJob.create({ data: { sourceId, attempt: prev + 1 }, include: this.include });
    return toDto(row, false);
  }

  async getImport(jobId: string) {
    const row = await this.prisma.importJob.findUnique({ where: { id: jobId }, include: this.include });
    return row ? toDto(row, true) : null;
  }

  async getSource(sourceId: string) {
    const s = await this.prisma.cadSource.findUnique({ where: { id: sourceId } });
    return s ? ({ id: s.id, projectId: s.projectId, originalName: s.originalName, safeName: s.safeName, format: s.format as UploadFormat, sizeBytes: s.sizeBytes, sha256: s.sha256, storagePath: s.storagePath } satisfies SourceRecord) : null;
  }

  async sourceForJob(jobId: string) {
    const j = await this.prisma.importJob.findUnique({ where: { id: jobId }, select: { sourceId: true } });
    return j ? this.getSource(j.sourceId) : null;
  }

  async listImports(projectId: string) {
    const rows = await this.prisma.importJob.findMany({ where: { source: { projectId } }, orderBy: { createdAt: 'desc' }, include: this.include });
    return rows.map((r) => toDto(r, false));
  }

  async markRunning(jobId: string) {
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'running', startedAt: new Date() } });
  }

  async finish(jobId: string, outcome: { result: CadParseResult } | { errorCode: string; errorMessage: string }) {
    if ('result' in outcome) {
      await this.prisma.$transaction([
        this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'succeeded', result: outcome.result as unknown as Prisma.InputJsonValue, finishedAt: new Date(), errorCode: null, errorMessage: null } }),
        this.prisma.drawingLayer.deleteMany({ where: { jobId } }),
        this.prisma.drawingLayer.createMany({ data: outcome.result.layers.map((l) => ({ jobId, name: l.name, entityCount: l.entityCount, types: l.types as Prisma.InputJsonValue })) }),
      ]);
    } else {
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'failed', errorCode: outcome.errorCode, errorMessage: outcome.errorMessage.slice(0, 500), finishedAt: new Date() } });
    }
  }
}

interface MemJob {
  id: string;
  sourceId: string;
  status: ImportJob['status'];
  errorCode: string | null;
  errorMessage: string | null;
  result: CadParseResult | null;
  createdAt: string;
  finishedAt: string | null;
}

export class MemoryImportRepository implements ImportRepository {
  private sources = new Map<string, SourceRecord>();
  private jobs = new Map<string, MemJob>();

  private dto(j: MemJob, withResult: boolean): ImportJob {
    const s = this.sources.get(j.sourceId)!;
    return { id: j.id, sourceId: j.sourceId, projectId: s.projectId, status: j.status, errorCode: j.errorCode, errorMessage: j.errorMessage, fileName: s.safeName, format: s.format, sha256: s.sha256, sizeBytes: s.sizeBytes, createdAt: j.createdAt, finishedAt: j.finishedAt, result: withResult ? j.result : null };
  }
  private newJob(sourceId: string): MemJob {
    const j: MemJob = { id: randomUUID(), sourceId, status: 'queued', errorCode: null, errorMessage: null, result: null, createdAt: new Date().toISOString(), finishedAt: null };
    this.jobs.set(j.id, j);
    return j;
  }
  async createSourceWithJob(src: Omit<SourceRecord, 'id'>) {
    const id = randomUUID();
    this.sources.set(id, { ...src, id });
    return this.dto(this.newJob(id), false);
  }
  async createJobForSource(sourceId: string) {
    return this.sources.has(sourceId) ? this.dto(this.newJob(sourceId), false) : null;
  }
  async getImport(jobId: string) {
    const j = this.jobs.get(jobId);
    return j ? this.dto(j, true) : null;
  }
  async getSource(sourceId: string) {
    return this.sources.get(sourceId) ?? null;
  }
  async sourceForJob(jobId: string) {
    const j = this.jobs.get(jobId);
    return j ? (this.sources.get(j.sourceId) ?? null) : null;
  }
  async listImports(projectId: string) {
    return [...this.jobs.values()].filter((j) => this.sources.get(j.sourceId)?.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((j) => this.dto(j, false));
  }
  async markRunning(jobId: string) {
    const j = this.jobs.get(jobId);
    if (j) j.status = 'running';
  }
  async finish(jobId: string, outcome: { result: CadParseResult } | { errorCode: string; errorMessage: string }) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.finishedAt = new Date().toISOString();
    if ('result' in outcome) {
      j.status = 'succeeded';
      j.result = outcome.result;
    } else {
      j.status = 'failed';
      j.errorCode = outcome.errorCode;
      j.errorMessage = outcome.errorMessage;
    }
  }
}
