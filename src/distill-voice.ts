#!/usr/bin/env node
import 'dotenv/config';
import { loadCorpus } from './corpus.js';
import { distillVoiceProfile, isStale, profileStore, refineVoiceProfile } from './voice-profile.js';
import { posts } from './ledger.js';

/**
 * Build or refresh the voice profile.
 *
 *   npm run distill-voice            rebuild from the corpus if it has changed
 *   npm run distill-voice -- --force rebuild regardless
 *   npm run distill-voice -- --learn fold review + engagement history into it
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const learn = args.includes('--learn');

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const corpus = loadCorpus();
  if (!corpus.length) {
    throw new Error(
      'No writing samples found. Add src/linkedInPosts.csv and/or src/xPosts.csv.',
    );
  }

  const existing = profileStore.read();
  let profile = existing;

  if (!existing || force || isStale(existing, corpus)) {
    console.log(`⏳ Distilling a voice profile from ${corpus.length} posts...`);
    profile = await distillVoiceProfile(corpus);

    console.log(`\n📝 ${profile.summary}\n`);
    console.log('Rules:');
    for (const rule of profile.rules) console.log(`  - ${rule}`);
  } else {
    console.log('✅ Voice profile is current with the corpus.');
  }

  if (learn && profile) {
    const history = await posts.all();
    console.log(`\n⏳ Folding in ${history.length} ledger entries...`);

    const before = profile.learned.length;
    profile = await refineVoiceProfile(profile, history);
    const added = profile.learned.slice(before);

    if (added.length) {
      console.log(`\n📚 ${added.length} new rule(s) learned:`);
      for (const rule of added) {
        console.log(`  - ${rule.rule}\n    (${rule.source}: ${rule.evidence})`);
      }
    } else {
      console.log('   No new rules — not enough evidence yet.');
    }
  }

  if (profile && profile !== existing) {
    profileStore.write(profile);
    console.log(`\n💾 Saved to ${profileStore.path} (version ${profile.version})`);
  }
}

main().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
