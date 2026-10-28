import { buildApp } from './app.ts';
import { MemoryRepository } from './memoryRepository.ts';
import type { ProjectRepository } from './repository.ts';

const port = Number(process.env['API_PORT'] ?? 4000);
const storage = process.env['STORAGE'] ?? (process.env['DATABASE_URL'] ? 'postgres' : 'memory');

async function createRepository(): Promise<ProjectRepository> {
  if (storage === 'memory') {
    console.warn(
      '\n[buildview-api] ⚠ STORAGE=memory: LOCAL DEVELOPMENT MODE. Projects are NOT persisted and are lost on restart.\n' +
        '                Set DATABASE_URL and run `npm run db:up` + `npm run db:migrate` for PostgreSQL.\n',
    );
    return new MemoryRepository();
  }
  if (!process.env['DATABASE_URL']) {
    throw new Error('STORAGE=postgres requires DATABASE_URL (see .env.example)');
  }
  const { PrismaRepository } = await import('./prismaRepository.ts');
  return new PrismaRepository();
}

const repo = await createRepository();
const app = buildApp(repo, { logger: true });

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
