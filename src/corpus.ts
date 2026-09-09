import * as fs from 'fs';
import * as crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import type { LinkedInCsvRow } from './types.js';

const LINKEDIN_CSV = process.env.LINKEDIN_CSV ?? './src/linkedInPosts.csv';
const X_CSV = process.env.X_CSV ?? './src/xPosts.csv';

const CSV_OPTIONS = {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,      // LinkedIn's export is not strictly RFC 4180
  relax_column_count: true,
  trim: true,
} as const;

/**
 * The raw writing samples a voice profile is distilled from.
 *
 * Both entry points used to carry their own near-identical copy of this — one
 * of which used `require` inside an ESM module and crashed in production.
 */
export function loadCorpus(): string[] {
  return [...loadLinkedInPosts(), ...loadXPosts()];
}

export function loadLinkedInPosts(file: string = LINKEDIN_CSV): string[] {
  if (!fs.existsSync(file)) return [];

  const rows: LinkedInCsvRow[] = parse(fs.readFileSync(file, 'utf8'), CSV_OPTIONS);

  return rows
    .map((row) => row.ShareCommentary?.replace(/""/g, '"').trim())
    .filter((text): text is string => Boolean(text));
}

/**
 * X's archive export has no stable column name across export vintages, so we
 * take the first column that looks like post text rather than guessing one.
 */
export function loadXPosts(file: string = X_CSV): string[] {
  if (!fs.existsSync(file)) return [];

  const rows: Record<string, string>[] = parse(fs.readFileSync(file, 'utf8'), CSV_OPTIONS);
  if (!rows.length) return [];

  const candidates = ['text', 'Text', 'tweet', 'Tweet', 'full_text', 'content'];
  const column = candidates.find((c) => c in rows[0]);
  if (!column) return [];

  return rows.map((row) => row[column]?.trim()).filter((text): text is string => Boolean(text));
}

/** Stable hash of the corpus, so we can tell when a profile is stale. */
export function fingerprint(posts: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const post of posts) hash.update(post);
  return hash.digest('hex').slice(0, 12);
}

/**
 * Pick a small, length-diverse sample to ground the profile.
 *
 * The point is to keep a handful of real sentences in the prompt without
 * shipping the whole corpus on every call — 58 posts was ~19k tokens per
 * generation, and most of it was redundant.
 */
export function selectExemplars(posts: string[], count = 6): string[] {
  if (posts.length <= count) return [...posts];

  const byLength = [...posts].sort((a, b) => a.length - b.length);

  // Even strides through the length distribution: short, mid and long samples.
  const step = (byLength.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => byLength[Math.round(i * step)]);
}
