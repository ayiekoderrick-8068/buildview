import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportJob } from '@buildview/shared';
import { MemoryRepository } from '../src/memoryRepository.ts';
import { checkUpload, safeFileName } from '../src/imports.ts';
import { FakeWorker, fixtureBytes, makeApp, startRealWorker } from './helpers.ts';

const upload = (app: ReturnType<typeof makeApp>['app'], projectId: string, name: string, bytes: Buffer, type = 'application/octet-stream') =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}/sources`, headers: { 'content-type': type, 'x-filename': encodeURIComponent(name) }, payload: bytes });

async function setup(worker = new FakeWorker()) {
  const repo = new MemoryRepository();
  const ctx = makeApp(repo, worker);
  const project = await repo.create('Imports', (await import('@buildview/design-engine')).createBlankDocument());
  return { ...ctx, repo, project, worker };
}

describe('upload validation (pure)', () => {
  it('accepts real DXF/DWG signatures and rejects renamed or hostile files', () => {
    const dxf = fixtureBytes('house-mm.dxf');
    expect(checkUpload('plan.dxf', dxf)).toMatchObject({ ok: true, format: 'dxf' });
    expect(checkUpload('PLAN.DXF', dxf).ok).toBe(true);
    expect(checkUpload('plan.dwg', fixtureBytes('fake.dwg'))).toMatchObject({ ok: true, format: 'dwg' });
    expect(checkUpload('plan.exe', dxf).code).toBe('unsupported_type');
    expect(checkUpload('plan.dxf', Buffer.from('MZ\x90\x00 this is an executable')).code).toBe('bad_signature');
    expect(checkUpload('plan.dxf', Buffer.from('<script>alert(1)</script>')).code).toBe('bad_signature');
    expect(checkUpload('plan.dwg', dxf).code).toBe('bad_signature');
    expect(checkUpload('plan.dxf', Buffer.alloc(0)).code).toBe('empty_file');
    expect(checkUpload('plan.dxf', Buffer.concat([Buffer.from('0\nSECTION\n'), Buffer.alloc(26 * 1024 * 1024)])).code).toBe('too_large');
    expect(checkUpload('plan.dxf.js', dxf).code).toBe('unsupported_type');
  });

  it('sanitises file names (no paths, no control characters)', () => {
    expect(safeFileName('../../etc/passwd.dxf')).toBe('passwd.dxf');
    expect(safeFileName('C:\\Users\\me\\plan 1.dxf')).toBe('plan 1.dxf');
    expect(safeFileName('..hidden.dxf')).toBe('hidden.dxf');
    expect(safeFileName('pl\u0000an<>.dxf')).toBe('pl_an__.dxf');
    expect(safeFileName('')).toBe('drawing');
  });
});

describe('import pipeline (fake worker)', () => {
  it('stores the original, checksums it, runs in the background and exposes the parse result', async () => {
    const { app, imports, files, project, worker } = await setup();
    const bytes = fixtureBytes('house-mm.dxf');
    const res = await upload(app, project.id, 'My House.dxf', bytes);
    expect(res.statusCode).toBe(202);
    const job = res.json<ImportJob>();
    expect(job.status).toBe('queued'); // returned before processing finished
    expect(job.result).toBeNull();
    expect(job.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await imports.idle();
    const done = (await app.inject({ method: 'GET', url: `/api/imports/${job.id}` })).json<ImportJob>();
    expect(done.status).toBe('succeeded');
    expect(done.result!.layers.map((l) => l.name)).toContain('A-WALL');
    expect(worker.calls).toBe(1);
    // original preserved byte-for-byte under a server-generated name
    const [stored] = [...files.files.entries()];
    expect(stored![0]).toMatch(new RegExp(`^${project.id}/[0-9a-f-]{36}\\.dxf$`));
    expect(Buffer.compare(stored![1], bytes)).toBe(0);
    const download = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/${done.sourceId}/file` });
    expect(Buffer.compare(download.rawPayload, bytes)).toBe(0);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects bad uploads without storing or processing anything', async () => {
    const { app, files, project, worker } = await setup();
    const dxf = fixtureBytes('house-mm.dxf');
    expect((await upload(app, project.id, 'virus.exe', dxf)).statusCode).toBe(415);
    expect((await upload(app, project.id, 'fake.dxf', Buffer.from('MZ not a drawing'))).statusCode).toBe(400);
    expect((await upload(app, project.id, 'plan.dxf', Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload(app, project.id, 'plan.dxf', Buffer.concat([Buffer.from('0\nSECTION\n'), Buffer.alloc(26 * 1024 * 1024)]))).statusCode).toBe(413);
    expect((await upload(app, project.id, 'plan.dxf', dxf, 'application/json')).statusCode).toBe(400);
    const noName = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/sources`, headers: { 'content-type': 'application/octet-stream' }, payload: dxf });
    expect(noName.statusCode).toBe(400);
    expect((await upload(app, '7b0b1c0e-0000-4000-8000-000000000000', 'plan.dxf', dxf)).statusCode).toBe(404);
    expect(files.files.size).toBe(0);
    expect(worker.calls).toBe(0);
  });

  it('path-traversal file names are neutralised', async () => {
    const { app, imports, files, project } = await setup();
    const res = await upload(app, project.id, '../../../etc/passwd.dxf', fixtureBytes('house-mm.dxf'));
    expect(res.statusCode).toBe(202);
    expect(res.json<ImportJob>().fileName).toBe('passwd.dxf');
    await imports.idle();
    expect([...files.files.keys()][0]).toMatch(new RegExp(`^${project.id}/`));
  });

  it('DWG is preserved but reported as unavailable (no converter), never faked', async () => {
    const { app, imports, project, files } = await setup();
    const res = await upload(app, project.id, 'house.dwg', fixtureBytes('fake.dwg'));
    expect(res.statusCode).toBe(202);
    await imports.idle();
    const job = (await app.inject({ method: 'GET', url: `/api/imports/${res.json<ImportJob>().id}` })).json<ImportJob>();
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('dwg_unavailable');
    expect(job.result).toBeNull();
    expect(files.files.size).toBe(1);
  });

  it('a worker outage fails the job cleanly and a retry succeeds once the worker is back', async () => {
    const { app, imports, project, worker } = await setup();
    worker.reachable = false;
    const first = (await upload(app, project.id, 'plan.dxf', fixtureBytes('house-mm.dxf'))).json<ImportJob>();
    await imports.idle();
    const failed = (await app.inject({ method: 'GET', url: `/api/imports/${first.id}` })).json<ImportJob>();
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'worker_unreachable' });
    worker.reachable = true;
    const retry = await app.inject({ method: 'POST', url: `/api/imports/${first.id}/retry` });
    expect(retry.statusCode).toBe(202);
    await imports.idle();
    const second = (await app.inject({ method: 'GET', url: `/api/imports/${retry.json<ImportJob>().id}` })).json<ImportJob>();
    expect(second.status).toBe('succeeded');
    expect(second.sourceId).toBe(first.sourceId); // same stored file, new attempt
    const list = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/imports` })).json<ImportJob[]>();
    expect(list.map((j) => j.status).sort()).toEqual(['failed', 'succeeded']);
  });

  it('repeated imports of the same file are independent sources with identical checksums', async () => {
    const { app, imports, project } = await setup();
    const bytes = fixtureBytes('house-mm.dxf');
    const a = (await upload(app, project.id, 'plan.dxf', bytes)).json<ImportJob>();
    const b = (await upload(app, project.id, 'plan.dxf', bytes)).json<ImportJob>();
    await imports.idle();
    expect(a.sourceId).not.toBe(b.sourceId);
    expect(a.sha256).toBe(b.sha256);
  });

  it('keeps a source download scoped to its own project', async () => {
    const { app, imports, project, repo } = await setup();
    const other = await repo.create('Other', project.document);
    const job = (await upload(app, project.id, 'plan.dxf', fixtureBytes('house-mm.dxf'))).json<ImportJob>();
    await imports.idle();
    const wrong = await app.inject({ method: 'GET', url: `/api/projects/${other.id}/sources/${job.sourceId}/file` });
    expect(wrong.statusCode).toBe(404);
  });

  it('reports a worker contract violation instead of trusting it', async () => {
    const { app, imports, project, worker } = await setup();
    worker.respond = () => ({ ok: false, code: 'worker_contract', message: 'The CAD worker returned data that does not match the expected format.' });
    const job = (await upload(app, project.id, 'plan.dxf', fixtureBytes('house-mm.dxf'))).json<ImportJob>();
    await imports.idle();
    expect((await app.inject({ method: 'GET', url: `/api/imports/${job.id}` })).json<ImportJob>().errorCode).toBe('worker_contract');
  });
});

describe('import pipeline (real Python worker)', () => {
  let real: Awaited<ReturnType<typeof startRealWorker>>;
  beforeAll(async () => {
    real = await startRealWorker();
    if (!real) console.warn('[api tests] cad-worker virtualenv not found - real-worker import tests skipped (run `npm run setup -w @buildview/cad-worker`)');
  }, 30_000);
  afterAll(() => real?.stop());

  const run = async (fixture: string, name = `${fixture}.dxf`) => {
    const { app, imports, project } = await setup(real!.worker as unknown as FakeWorker);
    const res = await upload(app, project.id, name, fixtureBytes(`${fixture}.dxf`));
    await imports.idle();
    return (await app.inject({ method: 'GET', url: `/api/imports/${res.json<ImportJob>().id}` })).json<ImportJob>();
  };

  it('parses the reference drawing end to end', async (ctx) => {
    if (!real) return ctx.skip();
    const job = await run('house-mm');
    expect(job.status).toBe('succeeded');
    expect(job.result!.units.toMetres).toBe(0.001);
    expect(job.result!.inserts).toHaveLength(4);
  });

  it('reports unsupported content, missing units and malformed files truthfully', async (ctx) => {
    if (!real) return ctx.skip();
    expect((await run('house-missing-units')).result!.units.toMetres).toBeNull();
    const bad = await run('malformed');
    expect(bad).toMatchObject({ status: 'failed', errorCode: 'malformed_dxf' });
  });

  it('DWG without a converter fails with dwg_unavailable', async (ctx) => {
    if (!real) return ctx.skip();
    const { app, imports, project } = await setup(real.worker as unknown as FakeWorker);
    const res = await upload(app, project.id, 'x.dwg', fixtureBytes('fake.dwg'));
    await imports.idle();
    expect((await app.inject({ method: 'GET', url: `/api/imports/${res.json<ImportJob>().id}` })).json<ImportJob>().errorCode).toBe('dwg_unavailable');
  });
});
