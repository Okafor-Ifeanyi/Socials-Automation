import * as fs from 'fs';
import * as path from 'path';
import { ensureSchema, getPool, inTransaction, isDatabaseConfigured } from './db.js';

/**
 * The persistence seam.
 *
 * Everything that outlives a run goes through these two interfaces. There are
 * two implementations: JSON files under ./data, and Postgres. Which one you get
 * depends on whether DATABASE_URL is set — callers never know the difference.
 *
 * Deliberately narrow. `update` is the only concession to the database: a
 * read-modify-write done as two calls loses one of two concurrent writes, and
 * once a UI and a cron job both touch the ledger that stops being theoretical.
 */
export interface Collection<T> {
  get(id: string): Promise<T | undefined>;
  put(id: string, value: T): Promise<void>;
  /** Read, transform and write one record atomically. Returns the new value. */
  update(id: string, change: (value: T) => T): Promise<T>;
  all(): Promise<T[]>;
  remove(id: string): Promise<void>;
}

/** A single named record, rather than a collection — used for the voice profile. */
export interface Document<T> {
  read(): Promise<T | undefined>;
  write(value: T): Promise<void>;
  /** Where the document lives, for error messages. */
  readonly location: string;
}

const DATA_DIR = process.env.DATA_DIR ?? './data';

// ─── JSON file backend ───────────────────────────────────────────────────────

/**
 * A collection backed by a single JSON file holding an id -> record map.
 *
 * Writes are atomic (temp file + rename) so an interrupted run can't leave a
 * half-written ledger behind. Single-writer only — concurrent processes will
 * clobber each other, which is exactly what the Postgres backend fixes.
 */
export class JsonCollection<T> implements Collection<T> {
  private readonly file: string;

  constructor(name: string, dir: string = DATA_DIR) {
    this.file = path.join(dir, `${name}.json`);
  }

  private read(): Record<string, T> {
    if (!fs.existsSync(this.file)) return {};
    const raw = fs.readFileSync(this.file, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, T>;
  }

  private write(records: Record<string, T>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async get(id: string): Promise<T | undefined> {
    return this.read()[id];
  }

  async put(id: string, value: T): Promise<void> {
    const records = this.read();
    records[id] = value;
    this.write(records);
  }

  async update(id: string, change: (value: T) => T): Promise<T> {
    const records = this.read();
    const existing = records[id];
    if (existing === undefined) throw new Error(`No record with id ${id}`);

    const updated = change(existing);
    records[id] = updated;
    this.write(records);

    return updated;
  }

  async all(): Promise<T[]> {
    return Object.values(this.read());
  }

  async remove(id: string): Promise<void> {
    const records = this.read();
    delete records[id];
    this.write(records);
  }
}

export class JsonDocument<T> implements Document<T> {
  private readonly file: string;

  constructor(name: string, dir: string = DATA_DIR) {
    this.file = path.join(dir, `${name}.json`);
  }

  async read(): Promise<T | undefined> {
    if (!fs.existsSync(this.file)) return undefined;
    const raw = fs.readFileSync(this.file, 'utf8').trim();
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  }

  async write(value: T): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get location(): string {
    return this.file;
  }
}

// ─── Postgres backend ────────────────────────────────────────────────────────

/**
 * A collection backed by one row per record, the record itself held as jsonb.
 *
 * The table name is interpolated rather than parameterised because Postgres
 * does not accept a bound parameter in that position; every construction site
 * is a literal in this repo, and the constructor rejects anything that is not
 * a plain identifier so it stays that way.
 */
export class PgCollection<T> implements Collection<T> {
  constructor(private readonly table: string) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      throw new Error(`Unsafe table name: ${table}`);
    }
  }

  async get(id: string): Promise<T | undefined> {
    await ensureSchema();

    const { rows } = await getPool().query<{ record: T }>(
      `select record from ${this.table} where id = $1`,
      [id],
    );

    return rows[0]?.record;
  }

  async put(id: string, value: T): Promise<void> {
    await ensureSchema();

    await getPool().query(
      `insert into ${this.table} (id, record) values ($1, $2)
       on conflict (id) do update set record = excluded.record, updated_at = now()`,
      [id, JSON.stringify(value)],
    );
  }

  /** Locks the row for the duration, so concurrent updates queue instead of racing. */
  async update(id: string, change: (value: T) => T): Promise<T> {
    await ensureSchema();

    return inTransaction(async (client) => {
      const { rows } = await client.query<{ record: T }>(
        `select record from ${this.table} where id = $1 for update`,
        [id],
      );

      const existing = rows[0]?.record;
      if (existing === undefined) throw new Error(`No record with id ${id}`);

      const updated = change(existing);

      await client.query(
        `update ${this.table} set record = $2, updated_at = now() where id = $1`,
        [id, JSON.stringify(updated)],
      );

      return updated;
    });
  }

  async all(): Promise<T[]> {
    await ensureSchema();

    const { rows } = await getPool().query<{ record: T }>(
      `select record from ${this.table} order by record ->> 'generatedAt'`,
    );

    return rows.map((row) => row.record);
  }

  async remove(id: string): Promise<void> {
    await ensureSchema();
    await getPool().query(`delete from ${this.table} where id = $1`, [id]);
  }
}

export class PgDocument<T> implements Document<T> {
  constructor(private readonly name: string) {}

  async read(): Promise<T | undefined> {
    await ensureSchema();

    const { rows } = await getPool().query<{ value: T }>(
      'select value from documents where name = $1',
      [this.name],
    );

    return rows[0]?.value;
  }

  async write(value: T): Promise<void> {
    await ensureSchema();

    await getPool().query(
      `insert into documents (name, value) values ($1, $2)
       on conflict (name) do update set value = excluded.value, updated_at = now()`,
      [this.name, JSON.stringify(value)],
    );
  }

  get location(): string {
    return `postgres:documents/${this.name}`;
  }
}

// ─── Backend selection ───────────────────────────────────────────────────────

/**
 * Pick a backend from the environment.
 *
 * Postgres when DATABASE_URL is set, JSON files otherwise. Keeping both means
 * the CLI still runs with no database, and the two can be diffed against each
 * other while migrating.
 */
export function collection<T>(name: string): Collection<T> {
  return isDatabaseConfigured() ? new PgCollection<T>(name) : new JsonCollection<T>(name);
}

export function document<T>(name: string): Document<T> {
  return isDatabaseConfigured() ? new PgDocument<T>(name) : new JsonDocument<T>(name);
}

/** Which backend is in use, for startup banners and diagnostics. */
export function backendName(): string {
  return isDatabaseConfigured() ? 'postgres' : `json (${DATA_DIR})`;
}
