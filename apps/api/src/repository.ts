import type { Project, ProjectSummary, SaveProjectRequest, SceneDocument } from '@buildview/shared';

export type SaveResult =
  | { status: 'saved'; project: Project }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'not-found' };

export interface RevisionSummary {
  revision: number;
  name: string;
  createdAt: string;
}

export interface ProjectRepository {
  readonly kind: 'postgres' | 'memory';
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project | null>;
  create(name: string, document: SceneDocument): Promise<Project>;
  save(id: string, request: SaveProjectRequest): Promise<SaveResult>;
  duplicate(id: string, name?: string): Promise<Project | null>;
  listRevisions(id: string): Promise<RevisionSummary[] | null>;
}
