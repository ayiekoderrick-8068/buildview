import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { createSampleDocument } from '@buildview/design-engine';
import {
  CreateProjectRequestSchema,
  DuplicateProjectRequestSchema,
  SaveProjectRequestSchema,
  type Health,
} from '@buildview/shared';
import type { ProjectRepository } from './repository.ts';

const IdParams = z.object({ id: z.uuid() });

export function buildApp(repo: ProjectRepository, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_failed',
        message: 'Request failed validation',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', message: (error as Error).message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'internal_error', message: 'Unexpected server error' });
  });

  app.get('/api/health', async (): Promise<Health> => ({ status: 'ok', storage: repo.kind }));

  app.get('/api/projects', async () => repo.list());

  app.post('/api/projects', async (request, reply) => {
    const body = CreateProjectRequestSchema.parse(request.body ?? {});
    const project = await repo.create(body.name ?? 'Sample living room', createSampleDocument());
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
    const result = await repo.save(id, body);
    if (result.status === 'not-found') {
      return reply.status(404).send({ error: 'not_found', message: 'Project not found' });
    }
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

  return app;
}
