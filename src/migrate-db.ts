#!/usr/bin/env node
import 'dotenv/config';
import { JsonCollection, JsonDocument, PgCollection, PgDocument } from './store.js';
import { closePool, ensureSchema, isDatabaseConfigured } from './db.js';
import type { PostRecord, VoiceProfile } from './types.js';

/**
 * Move the JSON ledger and voice profile into Postgres.
 *
 * Idempotent: every write is an upsert keyed by id, so re-running after a
 * partial failure is safe and re-running after further CLI use tops the
 * database up rather than duplicating anything.
 *
 *   npm run migrate-db            copy data/ into Postgres, then verify
 *   npm run migrate-db -- --verify  compare only, write nothing
 *
 * The JSON files are left untouched. Delete them only once you have run the
 * CLI against the database and are satisfied — until then they are the backup.
 */

interface Diff {
  missing: string[];
  differing: string[];
}

/**
 * Serialise with object keys sorted, at every depth.
 *
 * Postgres `jsonb` stores a parsed object, not the text it was given, and
 * re-emits keys shortest-first rather than in insertion order. A plain
 * `JSON.stringify` comparison therefore reports every single record as
 * differing when nothing about it has actually changed.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );
}

function comparePosts(source: PostRecord[], target: PostRecord[]): Diff {
  const byId = new Map(target.map((post) => [post.id, post]));

  const missing: string[] = [];
  const differing: string[] = [];

  for (const post of source) {
    const found = byId.get(post.id);

    if (!found) missing.push(post.id);
    else if (canonical(found) !== canonical(post)) differing.push(post.id);
  }

  return { missing, differing };
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify');

  if (!isDatabaseConfigured()) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        'Create a free Postgres database (neon.tech or supabase.com), then add its\n' +
        'connection string to .env as DATABASE_URL=postgres://...',
    );
  }

  // Read the file backend explicitly rather than through the factory — with
  // DATABASE_URL set, the factory would hand back Postgres on both sides and
  // the migration would silently copy the database onto itself.
  const jsonPosts = new JsonCollection<PostRecord>('posts');
  const jsonProfile = new JsonDocument<VoiceProfile>('voice-profile');

  const pgPosts = new PgCollection<PostRecord>('posts');
  const pgProfile = new PgDocument<VoiceProfile>('voice-profile');

  console.log('🗄️  Connecting and ensuring schema...');
  await ensureSchema();
  console.log('   ✅ schema ready\n');

  const sourcePosts = await jsonPosts.all();
  const sourceProfile = await jsonProfile.read();

  console.log(`📖 Found ${sourcePosts.length} post(s) and ` +
    `${sourceProfile ? 'a' : 'no'} voice profile in ${jsonProfile.location.replace(/[^/]+$/, '')}`);

  if (!verifyOnly) {
    for (const post of sourcePosts) {
      await pgPosts.put(post.id, post);
      console.log(`   → ${post.id} (${post.status})`);
    }

    if (sourceProfile) {
      await pgProfile.write(sourceProfile);
      console.log(
        `   → voice profile ${sourceProfile.version} ` +
          `(${sourceProfile.rules.length} rules, ${sourceProfile.learned.length} learned)`,
      );
    }
  }

  console.log('\n🔍 Verifying...');

  const targetPosts = await pgPosts.all();
  const { missing, differing } = comparePosts(sourcePosts, targetPosts);

  for (const id of missing) console.error(`   ❌ missing in Postgres: ${id}`);
  for (const id of differing) console.error(`   ❌ differs from the file: ${id}`);

  const targetProfile = await pgProfile.read();
  const profileMatches =
    canonical(sourceProfile ?? null) === canonical(targetProfile ?? null);

  if (!profileMatches) console.error('   ❌ voice profile differs from the file');

  if (missing.length || differing.length || !profileMatches) {
    throw new Error('Verification failed — the database does not match the files');
  }

  console.log(`   ✅ ${targetPosts.length} post(s) and the voice profile match the files`);

  // Anything already in Postgres but absent from the files is expected once the
  // database is the source of truth; report it so a surprise is visible.
  const extra = targetPosts.length - sourcePosts.length;
  if (extra > 0) {
    console.log(`   ℹ️  ${extra} post(s) exist only in Postgres (written since the files).`);
  }

  console.log(
    verifyOnly
      ? '\n✅ Verified. Nothing was written.'
      : '\n✅ Migrated. Every command now reads and writes Postgres while DATABASE_URL is set.\n' +
        '   Unset it to fall back to the JSON files.',
  );
}

main()
  .catch((error: Error) => {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
