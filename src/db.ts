import { Pool, type PoolClient } from 'pg';

/**
 * The Postgres connection, and the schema it expects.
 *
 * Only reached when DATABASE_URL is set — `store.ts` falls back to JSON files
 * otherwise, so the CLI keeps working on a laptop with no database.
 *
 * The schema is deliberately thin: one jsonb column per record, mirroring the
 * TypeScript types exactly. Splitting `PostRecord` into real columns would mean
 * a migration every time the domain model gains a field, for no benefit at
 * these volumes. `status` is projected out as a generated column because it is
 * the only field ever filtered on.
 */

let pool: Pool | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Decide the TLS setting, deferring to the connection string when it has one.
 *
 * Passing an `ssl` object alongside a URL that already carries `sslmode` sets
 * two policies for one connection and leaves which wins up to the driver — so
 * if the URL states its intent, say nothing and let it stand. The fallback is
 * only for hosted databases whose URL omits `sslmode` entirely: they still
 * require TLS, and some present a chain Node ships no root for.
 */
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  if (/[?&]sslmode=/.test(connectionString)) return undefined;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString)) return undefined;

  return { rejectUnauthorized: false };
}

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  pool = new Pool({
    connectionString,
    ssl: sslFor(connectionString),
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error on an idle client is emitted on the pool, and an unhandled
  // 'error' event takes the process down — including mid-publish.
  pool.on('error', (error) => {
    console.warn(`⚠️  Postgres pool error: ${error.message}`);
  });

  return pool;
}

const SCHEMA = `
  create table if not exists posts (
    id text primary key,
    record jsonb not null,
    -- Immutable projection: jsonb ->> text is immutable, so it is legal in a
    -- generated column. A timestamptz cast is not, which is why generatedAt is
    -- ordered on as ISO text instead (lexicographic order is chronological).
    status text generated always as (record ->> 'status') stored,
    updated_at timestamptz not null default now()
  );

  create index if not exists posts_status_idx on posts (status);
  create index if not exists posts_generated_at_idx on posts ((record ->> 'generatedAt'));

  create table if not exists documents (
    name text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
  );
`;

let schemaReady: Promise<void> | undefined;

/** Create the schema if it is missing. Runs once per process, lazily. */
export function ensureSchema(): Promise<void> {
  schemaReady ??= getPool()
    .query(SCHEMA)
    .then(() => undefined);

  return schemaReady;
}

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * Used for read-modify-write on a single record, which is how every ledger
 * update works. Without `select ... for update` inside a transaction, the UI
 * approving a post and the cron recording its publication can read the same
 * row and the second write silently discards the first.
 */
export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Close the pool so a CLI process can exit instead of hanging on idle sockets. */
export async function closePool(): Promise<void> {
  if (!pool) return;

  const closing = pool;
  pool = undefined;
  schemaReady = undefined;
  await closing.end();
}
