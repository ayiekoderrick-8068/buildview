import { buildApp } from './app.ts';
import { DiskFileStore, HttpCadWorker, ImportService } from './imports.ts';
import { MemoryImportRepository } from './importRepositories.ts';
import { MemoryRepository } from './memoryRepository.ts';
import type { ProjectRepository } from './repository.ts';

const port = Number(process.env['API_PORT'] ?? 4000);
const storage = process.env['STORAGE'] ?? (process.env['DATABASE_URL'] ? 'postgres' : 'memory');

async function createServices() {
  if (storage === 'memory') {
    console.warn(
      '\n[buildview-api] ⚠ STORAGE=memory: LOCAL DEVELOPMENT MODE. Projects and import records are NOT persisted and are lost on restart.\n' +
        '                Set DATABASE_URL and run `npm run db:up` + `npm run db:migrate` for PostgreSQL.\n',
    );
    return { repo: new MemoryRepository() as ProjectRepository, imports: new MemoryImportRepository() };
  }
  if (!process.env['DATABASE_URL']) throw new Error('STORAGE=postgres requires DATABASE_URL (see .env.example)');
  const [{ PrismaRepository }, { PrismaImportRepository }] = await Promise.all([import('./prismaRepository.ts'), import('./importRepositories.ts')]);
  const repo = new PrismaRepository();
  return { repo: repo as ProjectRepository, imports: new PrismaImportRepository(repo.client) };
}

const { repo, imports } = await createServices();
const service = new ImportService(imports, new DiskFileStore(), new HttpCadWorker());
const app = buildApp(repo, { imports: service, logger: true });

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
