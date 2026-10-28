import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleDocument, updateSurfaces } from '@buildview/design-engine';
import type { Project } from '@buildview/shared';
import { buildApp } from '../src/app.ts';
import { MemoryRepository } from '../src/memoryRepository.ts';
import type { ProjectRepository } from '../src/repository.ts';

/**
 * The same contract suite runs against the in-memory repository (always) and against real
 * PostgreSQL via Prisma (when DATABASE_URL points at a reachable, migrated database).
 */
async function tryPostgres(): Promise<ProjectRepository | null> {
  if (!process.env['DATABASE_URL']) return null;
  try {
    const { PrismaRepository } = await import('../src/prismaRepository.ts');
    const repo = new PrismaRepository();
    await repo.list();
    return repo;
  } catch {
    return null;
  }
}

const postgres = await tryPostgres();
const targets: Array<[string, ProjectRepository]> = [['memory', new MemoryRepository()]];
if (postgres) targets.push(['postgres', postgres]);
else console.warn('[api tests] PostgreSQL unavailable - persistence suite ran against memory only');

describe.each(targets)('project API (%s storage)', (_name, repo) => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = buildApp(repo);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if ('disconnect' in repo) await (repo as { disconnect(): Promise<void> }).disconnect();
  });

  const create = async (name?: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: name ? { name } : {} });
    expect(res.statusCode).toBe(201);
    return res.json<Project>();
  };

  it('reports its storage backend', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok', storage: repo.kind });
  });

  it('creates a sample project with stable wall ids and revision 1', async () => {
    const project = await create('Test room');
    expect(project.revision).toBe(1);
    expect(project.document.walls.map((w) => w.id)).toEqual(['wall-north', 'wall-east', 'wall-south', 'wall-west']);
    expect(project.document.room.length).toBe(5);
  });

  it('saves a material change and reloads it exactly (fidelity)', async () => {
    const project = await create();
    const edited = updateSurfaces(project.document, ['wall-north'], { color: '#C4553B', finish: 'satin' });
    const save = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}`,
      payload: { baseRevision: 1, document: edited, editorMeta: { view: '3d' } },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json<Project>().revision).toBe(2);

    const reloaded = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<Project>();
    expect(reloaded.revision).toBe(2);
    expect(reloaded.document).toEqual(edited);
    expect(reloaded.document.walls).toEqual(project.document.walls); // geometry unchanged
    expect(reloaded.editorMeta).toEqual({ view: '3d' });

    const revisions = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/revisions` })).json<Array<{ revision: number }>>();
    expect(revisions.map((r) => r.revision)).toEqual([2, 1]);
  });

  it('rejects stale saves with 409 instead of overwriting', async () => {
    const project = await create();
    const first = await app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: { baseRevision: 1, document: project.document } });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: { baseRevision: 1, document: project.document } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentRevision).toBe(2);
  });

  it('duplicates a project with an independent copy', async () => {
    const project = await create('Original');
    const edited = updateSurfaces(project.document, ['wall-east'], { color: '#1F2F54' });
    await app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: { baseRevision: 1, document: edited } });
    const res = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/duplicate`, payload: {} });
    expect(res.statusCode).toBe(201);
    const copy = res.json<Project>();
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.revision).toBe(1);
    expect(copy.document.surfaces['wall-east']?.color).toBe('#1F2F54');
  });

  it('validates input', async () => {
    const project = await create();
    const bad = (payload: unknown) => app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: payload as object });

    expect((await bad({})).statusCode).toBe(400);
    expect((await bad({ baseRevision: 0, document: project.document })).statusCode).toBe(400);

    const invalidColor = structuredClone(project.document);
    invalidColor.surfaces['wall-north']!.color = 'not-a-colour';
    const res = await bad({ baseRevision: 1, document: invalidColor });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');

    const badRoughness = structuredClone(project.document);
    badRoughness.surfaces['wall-north']!.roughness = 5;
    expect((await bad({ baseRevision: 1, document: badRoughness })).statusCode).toBe(400);

    expect((await app.inject({ method: 'GET', url: '/api/projects/not-a-uuid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/projects/7b0b1c0e-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } })).statusCode).toBe(400);
  });

  it('did not persist anything from rejected saves', async () => {
    const project = await create();
    const invalid = structuredClone(project.document);
    invalid.surfaces['wall-north']!.color = 'bad';
    await app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: { baseRevision: 1, document: invalid } });
    const reloaded = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<Project>();
    expect(reloaded.revision).toBe(1);
    expect(reloaded.document).toEqual(createSampleDocument());
  });
});
