import * as fs from 'fs';
import * as path from 'path';

/**
 * The persistence seam.
 *
 * Everything that outlives a run goes through this interface. Today it is
 * JSON files under ./data; swapping in Postgres or Mongo for multi-tenant use
 * means writing one more implementation, not touching callers.
 *
 * Deliberately narrow: get / put / all / remove. No queries, no joins — the
 * volumes here are tiny and a richer interface would be harder to reimplement.
 */
export interface Collection<T> {
  get(id: string): Promise<T | undefined>;
  put(id: string, value: T): Promise<void>;
  all(): Promise<T[]>;
  remove(id: string): Promise<void>;
}

const DATA_DIR = process.env.DATA_DIR ?? './data';

/**
 * A collection backed by a single JSON file holding an id -> record map.
 *
 * Writes are atomic (temp file + rename) so an interrupted run can't leave a
 * half-written ledger behind. Single-writer only — concurrent processes will
 * clobber each other, which is fine for one cron job and is the first thing a
 * real database fixes.
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

  async all(): Promise<T[]> {
    return Object.values(this.read());
  }

  async remove(id: string): Promise<void> {
    const records = this.read();
    delete records[id];
    this.write(records);
  }
}

/**
 * A single JSON document (not a collection) — used for the voice profile.
 */
export class JsonDocument<T> {
  private readonly file: string;

  constructor(name: string, dir: string = DATA_DIR) {
    this.file = path.join(dir, `${name}.json`);
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  read(): T | undefined {
    if (!this.exists()) return undefined;
    const raw = fs.readFileSync(this.file, 'utf8').trim();
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get path(): string {
    return this.file;
  }
}
