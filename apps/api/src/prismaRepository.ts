import { PrismaClient, type Prisma } from '@prisma/client';
import { upgradeDocument } from '@buildview/design-engine';
import {
  ProjectSchema,
  type Project,
  type SaveProjectRequest,
  type SceneDocument,
} from '@buildview/shared';
import type { ProjectRepository, RevisionSummary, SaveResult } from './repository.ts';

type Row = {
  id: string;
  name: string;
  revision: number;
  updatedAt: Date;
  document: Prisma.JsonValue;
  editorMeta: Prisma.JsonValue;
};

function toProject(row: Row): Project {
  // Documents written by Prompt 1 (schema v1) are upgraded on read, then re-validated, so a
  // corrupted/legacy row never reaches the editor unchecked.
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    document: upgradeDocument(row.document),
    editorMeta: row.editorMeta,
  });
}

const summary = (d: SceneDocument) => ({
  wallCount: d.walls.length,
  openingCount: d.openings.length,
  roomCount: d.rooms.length,
  approved: d.approval.status === 'approved',
});

export class PrismaRepository implements ProjectRepository {
  readonly kind = 'postgres' as const;
  readonly client: PrismaClient;

  constructor(prisma: PrismaClient = new PrismaClient()) {
    this.client = prisma;
  }
  private get prisma() {
    return this.client;
  }

  async list() {
    const rows = await this.prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, revision: true, updatedAt: true },
    });
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  async get(id: string) {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row ? toProject(row) : null;
  }

  async create(name: string, document: SceneDocument) {
    const json = document as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.project.create({
      data: { name, ...summary(document), document: json, revisions: { create: { revision: 1, name, document: json } } },
    });
    return toProject(row);
  }

  async save(id: string, request: SaveProjectRequest): Promise<SaveResult> {
    const { document, editorMeta, baseRevision } = request;
    const json = document as unknown as Prisma.InputJsonValue;
    return this.prisma.$transaction(async (tx): Promise<SaveResult> => {
      // Compare-and-set on the revision so concurrent saves cannot silently overwrite each other.
      const updated = await tx.project.updateMany({
        where: { id, revision: baseRevision },
        data: {
          ...(request.name ? { name: request.name } : {}),
          ...summary(document),
          document: json,
          editorMeta: editorMeta as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        const existing = await tx.project.findUnique({ where: { id }, select: { revision: true } });
        return existing ? { status: 'conflict', currentRevision: existing.revision } : { status: 'not-found' };
      }
      const row = await tx.project.findUniqueOrThrow({ where: { id } });
      await tx.projectRevision.create({
        data: { projectId: id, revision: row.revision, name: row.name, document: json, editorMeta: editorMeta as Prisma.InputJsonValue },
      });
      return { status: 'saved', project: toProject(row) };
    });
  }

  async duplicate(id: string, name?: string) {
    const source = await this.get(id);
    if (!source) return null;
    // Source-file references belong to the original project; the copy starts without them.
    return this.create(name ?? `${source.name} (copy)`, { ...source.document, sources: [] });
  }

  async listRevisions(id: string): Promise<RevisionSummary[] | null> {
    const exists = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const rows = await this.prisma.projectRevision.findMany({
      where: { projectId: id },
      orderBy: { revision: 'desc' },
      select: { revision: true, name: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }
}
