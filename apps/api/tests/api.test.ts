import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBlankDocument, createSampleDocument, moveOpening, setWallLength, updateSurfaces } from '@buildview/design-engine';
import type { Project } from '@buildview/shared';
import { MemoryImportRepository } from '../src/importRepositories.ts';
import type { ImportRepository } from '../src/imports.ts';
import { MemoryRepository } from '../src/memoryRepository.ts';
import type { ProjectRepository } from '../src/repository.ts';
import { makeApp } from './helpers.ts';

/**
 * The same contract suite runs against the in-memory repository (always) and against real
 * PostgreSQL via Prisma (when DATABASE_URL points at a reachable, migrated database).
 */
async function tryPostgres(): Promise<{ repo: ProjectRepository; imports: ImportRepository } | null> {
  if (!process.env['DATABASE_URL']) return null;
  try {
    const { PrismaRepository } = await import('../src/prismaRepository.ts');
    const { PrismaImportRepository } = await import('../src/importRepositories.ts');
    const repo = new PrismaRepository();
    await repo.list();
    return { repo, imports: new PrismaImportRepository(repo.client) };
  } catch {
    return null;
  }
}

const postgres = await tryPostgres();
const targets: Array<[string, ProjectRepository, ImportRepository]> = [['memory', new MemoryRepository(), new MemoryImportRepository()]];
if (postgres) targets.push(['postgres', postgres.repo, postgres.imports]);
else console.warn('[api tests] PostgreSQL unavailable - persistence suite ran against memory only');

describe.each(targets)('project API (%s storage)', (_name, repo, importRepo) => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = makeApp(repo, undefined, importRepo).app;
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if ('disconnect' in repo) await (repo as { disconnect(): Promise<void> }).disconnect();
  });

  const create = async (payload: object = {}) => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(res.statusCode).toBe(201);
    return res.json<Project>();
  };
  const put = (id: string, payload: object) => app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload });

  it('reports its storage backend and CAD capabilities honestly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.storage).toBe(repo.kind);
    expect(body.capabilities).toMatchObject({ dxf: true, dwg: false, malwareScanning: false });
    expect(body.capabilities.dwgReason).toMatch(/converter/i);
  });

  it('creates sample and blank projects', async () => {
    const sample = await create({ name: 'Test room' });
    expect(sample.revision).toBe(1);
    expect(sample.document.walls.map((w) => w.id)).toEqual(['wall-north', 'wall-east', 'wall-south', 'wall-west']);
    const blank = await create({ template: 'blank' });
    expect(blank.document.walls).toEqual([]);
    expect(blank.name).toBe('Untitled house');
  });

  it('saves a material change and reloads it exactly (fidelity), with revision history', async () => {
    const project = await create();
    const edited = updateSurfaces(project.document, ['wall-north'], { color: '#C4553B', finish: 'satin' });
    const save = await put(project.id, { baseRevision: 1, document: edited, editorMeta: { view: '3d' } });
    expect(save.statusCode).toBe(200);
    expect(save.json<Project>().revision).toBe(2);
    const reloaded = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<Project>();
    expect(reloaded.document).toEqual(edited);
    expect(reloaded.document.walls).toEqual(project.document.walls);
    expect(reloaded.editorMeta).toEqual({ view: '3d' });
    const revisions = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/revisions` })).json<Array<{ revision: number }>>();
    expect(revisions.map((r) => r.revision)).toEqual([2, 1]);
  });

  it('persists geometry edits exactly (opening moved)', async () => {
    const project = await create();
    const edited = moveOpening(project.document, 'window-main', 1.9);
    expect((await put(project.id, { baseRevision: 1, document: edited })).statusCode).toBe(200);
    const back = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<Project>();
    expect(back.document.openings.find((o) => o.id === 'window-main')!.offsetM).toBe(1.9);
  });

  it('rejects stale saves with 409 instead of overwriting', async () => {
    const project = await create();
    expect((await put(project.id, { baseRevision: 1, document: project.document })).statusCode).toBe(200);
    const stale = await put(project.id, { baseRevision: 1, document: project.document });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentRevision).toBe(2);
  });

  it('duplicates a project with an independent copy', async () => {
    const project = await create({ name: 'Original' });
    await put(project.id, { baseRevision: 1, document: updateSurfaces(project.document, ['wall-east'], { color: '#1F2F54' }) });
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
    expect((await put(project.id, {})).statusCode).toBe(400);
    expect((await put(project.id, { baseRevision: 0, document: project.document })).statusCode).toBe(400);
    const bad = structuredClone(project.document);
    bad.surfaces['wall-north']!.color = 'not-a-colour';
    const res = await put(project.id, { baseRevision: 1, document: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    const negative = structuredClone(project.document);
    negative.walls[0]!.thicknessM = -1;
    expect((await put(project.id, { baseRevision: 1, document: negative })).statusCode).toBe(400);
    const v1 = { ...project.document, schemaVersion: 1 };
    expect((await put(project.id, { baseRevision: 1, document: v1 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/projects/not-a-uuid' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/projects/7b0b1c0e-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { template: 'villa' } })).statusCode).toBe(400);
  });

  it('refuses to approve a model with critical validation issues (server-side), but saves it as draft', async () => {
    const project = await create();
    const broken = setWallLength(project.document, 'wall-north', 1.0); // window no longer fits
    const approved = { ...broken, approval: { status: 'approved' as const, approvedAt: '2026-01-01T00:00:00Z' } };
    const res = await put(project.id, { baseRevision: 1, document: approved });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('approval_blocked');
    expect((await put(project.id, { baseRevision: 1, document: broken })).statusCode).toBe(200);
    const ok = { ...project.document, approval: { status: 'approved' as const, approvedAt: '2026-01-01T00:00:00Z' } };
    expect((await put(project.id, { baseRevision: 2, document: ok })).statusCode).toBe(200);
  });

  it('refuses source references that belong to another project', async () => {
    const project = await create({ template: 'blank' });
    const doc = {
      ...createBlankDocument(),
      sources: [{ sourceId: '7b0b1c0e-0000-4000-8000-000000000001', importJobId: 'x', fileName: 'a.dxf', sha256: 'a'.repeat(64), confirmedUnit: 'mm', toMetres: 0.001, layerMap: {}, originM: { x: 0, y: 0 }, issues: [] }],
    };
    const res = await put(project.id, { baseRevision: 1, document: doc });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('unknown_source');
  });

  it('did not persist anything from rejected saves', async () => {
    const project = await create();
    const invalid = structuredClone(project.document);
    invalid.surfaces['wall-north']!.color = 'bad';
    await put(project.id, { baseRevision: 1, document: invalid });
    const reloaded = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<Project>();
    expect(reloaded.revision).toBe(1);
    expect(reloaded.document).toEqual(createSampleDocument());
  });
});
