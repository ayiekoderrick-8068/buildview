/**
 * Starts a local PostgreSQL for development without Docker or system packages, using the
 * `embedded-postgres` npm package (real PostgreSQL binaries). Data persists in .data/postgres.
 *
 *   npm run db:up      # leaves running in the foreground; Ctrl+C to stop
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env['PG_PORT'] ?? 54329);
const databaseDir = path.resolve('.data/postgres');
const initialised = existsSync(path.join(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'buildview',
  password: 'buildview',
  port,
  persistent: true,
});

if (!initialised) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('buildview');
} catch {
  // already exists
}

console.log(`PostgreSQL ready: postgresql://buildview:buildview@localhost:${port}/buildview`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
