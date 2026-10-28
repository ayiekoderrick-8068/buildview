import { randomUUID } from 'node:crypto';
import type { Project, SaveProjectRequest, SceneDocument } from '@buildview/shared';
import type { ProjectRepository, RevisionSummary, SaveResult } from './repository.ts';

/**
 * LOCAL DEVELOPMENT / TEST ONLY. Data lives in process memory and is lost on restart.
 * The web app displays a visible "memory storage" warning when the API runs with this repository.
 */
export class MemoryRepository implements ProjectRepository {
  readonly kind = 'memory' as const;
  private projects = new Map<string, Project>();
  private revisions = new Map<string, RevisionSummary[]>();

  async list() {
    return [...this.projects.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, revision, updatedAt }) => ({ id, name, revision, updatedAt }));
  }

  async get(id: string) {
    const project = this.projects.get(id);
    return project ? structuredClone(project) : null;
  }

  async create(name: string, document: SceneDocument) {
    const project: Project = {
      id: randomUUID(),
      name,
      revision: 1,
      updatedAt: new Date().toISOString(),
      document: structuredClone(document),
      editorMeta: {},
    };
    this.projects.set(project.id, project);
    this.revisions.set(project.id, [{ revision: 1, name, createdAt: project.updatedAt }]);
    return structuredClone(project);
  }

  async save(id: string, request: SaveProjectRequest): Promise<SaveResult> {
    const current = this.projects.get(id);
    if (!current) return { status: 'not-found' };
    if (current.revision !== request.baseRevision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    const updated: Project = {
      ...current,
      name: request.name ?? current.name,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      document: structuredClone(request.document),
      editorMeta: structuredClone(request.editorMeta),
    };
    this.projects.set(id, updated);
    this.revisions.get(id)?.push({ revision: updated.revision, name: updated.name, createdAt: updated.updatedAt });
    return { status: 'saved', project: structuredClone(updated) };
  }

  async duplicate(id: string, name?: string) {
    const source = this.projects.get(id);
    if (!source) return null;
    // Source-file references belong to the original project; the copy starts without them.
    return this.create(name ?? `${source.name} (copy)`, { ...source.document, sources: [] });
  }

  async listRevisions(id: string): Promise<RevisionSummary[] | null> {
    const list = this.revisions.get(id);
    return list ? [...list].reverse() : null;
  }
}
