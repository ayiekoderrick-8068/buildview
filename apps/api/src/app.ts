import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { createBlankDocument, createSampleDocument } from '@buildview/design-engine';
import { hasBlockingIssues, validateDocument } from '@buildview/geometry-engine';
import {
  CreateProjectRequestSchema,
  DuplicateProjectRequestSchema,
  SaveProjectRequestSchema,
  type Health,
} from '@buildview/shared';
import { checkUpload, MAX_UPLOAD_BYTES, safeFileName, type ImportService } from './imports.ts';
import type { ProjectRepository } from './repository.ts';

const IdParams = z.object({ id: z.uuid() });
const ProjectSourceParams = z.object({ id: z.uuid(), sourceId: z.uuid() });
const JobParams = z.object({ jobId: z.uuid() });

export function buildApp(repo: ProjectRepository, deps: { imports: ImportService; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const imports = deps.imports;

  app.register(cors, { origin: true });

  // Raw uploads: never parsed or executed here; handed to the CAD worker as bytes.
  app.addContentTypeParser(
    ['application/octet-stream', 'application/dxf', 'application/acad', 'image/vnd.dxf'],
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_failed',
        message: 'Request failed validation',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) return reply.status(413).send({ error: 'too_large', message: `The upload exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit.` });
    if (statusCode && statusCode < 500) return reply.status(statusCode).send({ error: 'bad_request', message: (error as Error).message });
    app.log.error(error);
    return reply.status(500).send({ error: 'internal_error', message: 'Unexpected server error' });
  });

  app.get('/api/health', async (): Promise<Health> => ({ status: 'ok', storage: repo.kind, capabilities: await imports.capabilities() }));

  app.get('/api/projects', async () => repo.list());

  app.post('/api/projects', async (request, reply) => {
    const body = CreateProjectRequestSchema.parse(request.body ?? {});
    const doc = body.template === 'blank' ? createBlankDocument() : createSampleDocument();
    const project = await repo.create(body.name ?? (body.template === 'blank' ? 'Untitled house' : 'Sample living room'), doc);
    return reply.status(201).send(project);
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const project = await repo.get(id);
    return project ?? reply.status(404).send({ error: 'not_found', message: 'Project not found' });
  });

  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = SaveProjectRequestSchema.parse(request.body);
    // The server, not the client, enforces that an unreliable model cannot be approved.
    if (body.document.approval.status === 'approved' && hasBlockingIssues(validateDocument(body.document))) {
      return reply.status(422).send({ error: 'approval_blocked', message: 'The model has unresolved critical validation issues and cannot be approved.' });
    }
    for (const s of body.document.sources) {
      const src = await imports.repo.getSource(s.sourceId);
      if (!src || src.projectId !== id) {
        return reply.status(422).send({ error: 'unknown_source', message: `Source drawing ${s.sourceId} does not belong to this project.` });
      }
    }
    const result = await repo.save(id, body);
    if (result.status === 'not-found') return reply.status(404).send({ error: 'not_found', message: 'Project not found' });
    if (result.status === 'conflict') {
      return reply.status(409).send({
        error: 'revision_conflict',
        message: 'The project was changed elsewhere. Reload before saving.',
        currentRevision: result.currentRevision,
      });
    }
    return result.project;
  });

  app.post('/api/projects/:id/duplicate', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = DuplicateProjectRequestSchema.parse(request.body ?? {});
    const copy = await repo.duplicate(id, body.name);
    return copy
      ? reply.status(201).send(copy)
      : reply.status(404).send({ error: 'not_found', message: 'Project not found' });
  });

  app.get('/api/projects/:id/revisions', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const revisions = await repo.listRevisions(id);
    return revisions ?? reply.status(404).send({ error: 'not_found', message: 'Project not found' });
  });

  // ---------------------------------------------------------------- CAD imports

  app.post('/api/projects/:id/sources', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    if (!(await repo.get(id))) return reply.status(404).send({ error: 'not_found', message: 'Project not found' });
    const rawName = request.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) return reply.status(400).send({ error: 'missing_filename', message: 'Send the file name in the X-Filename header.' });
    let decoded = rawName;
    try {
      decoded = decodeURIComponent(rawName);
    } catch {
      /* keep raw */
    }
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes)) return reply.status(415).send({ error: 'unsupported_media_type', message: 'Upload the raw file with Content-Type: application/octet-stream.' });
    const check = checkUpload(safeFileName(decoded), bytes);
    if (!check.ok || !check.format) {
      const status = check.code === 'too_large' ? 413 : check.code === 'unsupported_type' ? 415 : 400;
      return reply.status(status).send({ error: check.code, message: check.message });
    }
    const job = await imports.submit(id, safeFileName(decoded), bytes, check.format);
    return reply.status(202).send(job);
  });

  app.get('/api/projects/:id/imports', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    if (!(await repo.get(id))) return reply.status(404).send({ error: 'not_found', message: 'Project not found' });
    return imports.repo.listImports(id);
  });

  app.get('/api/imports/:jobId', async (request, reply) => {
    const { jobId } = JobParams.parse(request.params);
    const job = await imports.repo.getImport(jobId);
    return job ?? reply.status(404).send({ error: 'not_found', message: 'Import not found' });
  });

  app.post('/api/imports/:jobId/retry', async (request, reply) => {
    const { jobId } = JobParams.parse(request.params);
    const job = await imports.retry(jobId);
    return job ? reply.status(202).send(job) : reply.status(404).send({ error: 'not_found', message: 'Import not found' });
  });

  // The original upload, byte-for-byte. Scoped to its project; never served as an inline document.
  app.get('/api/projects/:id/sources/:sourceId/file', async (request, reply) => {
    const { id, sourceId } = ProjectSourceParams.parse(request.params);
    const src = await imports.repo.getSource(sourceId);
    if (!src || src.projectId !== id) return reply.status(404).send({ error: 'not_found', message: 'Source not found' });
    const bytes = await imports.files.read(src.storagePath);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${src.safeName}"`)
      .header('x-content-type-options', 'nosniff')
      .send(bytes);
  });

  return app;
}
