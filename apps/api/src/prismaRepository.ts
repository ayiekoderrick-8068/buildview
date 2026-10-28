import { PrismaClient, type Prisma } from '@prisma/client';
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
  // Re-validate on read so a corrupted/legacy row never reaches the editor unchecked.
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    document: row.document,
    editorMeta: row.editorMeta,
  });
}

const roomColumns = (document: SceneDocument) => ({
  roomLength: document.room.length,
  roomWidth: document.room.width,
  roomHeight: document.room.height,
  wallThickness: document.room.wallThickness,
});

export class PrismaRepository implements ProjectRepository {
  readonly kind = 'postgres' as const;

  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

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
    const row = await this.prisma.project.create({
      data: {
        name,
        ...roomColumns(document),
        document: document as unknown as Prisma.InputJsonValue,
        revisions: {
          create: { revision: 1, name, document: document as unknown as Prisma.InputJsonValue },
        },
      },
    });
    return toProject(row);
  }

  async save(id: string, request: SaveProjectRequest): Promise<SaveResult> {
    const { document, editorMeta, baseRevision } = request;
    return this.prisma.$transaction(async (tx): Promise<SaveResult> => {
      // Compare-and-set on the revision so concurrent saves cannot silently overwrite each other.
      const updated = await tx.project.updateMany({
        where: { id, revision: baseRevision },
        data: {
          ...(request.name ? { name: request.name } : {}),
          ...roomColumns(document),
          document: document as unknown as Prisma.InputJsonValue,
          editorMeta: editorMeta as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        const existing = await tx.project.findUnique({ where: { id }, select: { revision: true } });
        return existing
          ? { status: 'conflict', currentRevision: existing.revision }
          : { status: 'not-found' };
      }
      const row = await tx.project.findUniqueOrThrow({ where: { id } });
      await tx.projectRevision.create({
        data: {
          projectId: id,
          revision: row.revision,
          name: row.name,
          document: document as unknown as Prisma.InputJsonValue,
          editorMeta: editorMeta as Prisma.InputJsonValue,
        },
      });
      return { status: 'saved', project: toProject(row) };
    });
  }

  async duplicate(id: string, name?: string) {
    const source = await this.get(id);
    if (!source) return null;
    return this.create(name ?? `${source.name} (copy)`, source.document);
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
