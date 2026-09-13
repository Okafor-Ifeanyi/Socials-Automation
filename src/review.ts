#!/usr/bin/env node
import 'dotenv/config';
import { runCli } from './cli.js';
import * as readline from 'readline/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { stdin, stdout } from 'process';
import { ask, askText } from './prompt.js';
import * as ledger from './ledger.js';
import { publishRecord, describePublications } from './pipeline.js';
import { nextSlot } from './schedule.js';
import { PLATFORM_LABELS } from './config.js';
import type { Platform, PlatformText, PostRecord, ReviewDecision } from './types.js';

/**
 * The approval gate — and the point where training signal is captured.
 *
 * Every decision made here (accept / edit / reject, plus a free-text critique
 * and the diff between what the model wrote and what actually went out) lands
 * in the ledger, where `distill-voice --learn` turns it into voice rules.
 * Without this step the system publishes but never learns.
 */

const PLATFORM_ORDER: Platform[] = ['twitter', 'linkedin'];

function show(post: PostRecord): void {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`📋 ${post.topic}`);
  console.log(`   generated ${new Date(post.generatedAt).toLocaleString()} · voice ${post.voiceProfileVersion}`);

  for (const platform of PLATFORM_ORDER) {
    const text = post.drafts[platform];
    if (!text) continue;

    console.log(`\n${PLATFORM_LABELS[platform]} (${text.length} chars)`);
    console.log('─'.repeat(60));
    console.log(text);
  }

  console.log('─'.repeat(60));
}

/**
 * Open the draft in $EDITOR.
 *
 * A LinkedIn post is multi-line by nature, and readline only ever reads one
 * line — so a prompt-based editor silently truncates exactly the posts most
 * worth editing.
 */
function editInEditor(label: string, text: string): string | undefined {
  const editor = process.env.EDITOR ?? process.env.VISUAL;
  if (!editor) return undefined;

  const file = path.join(os.tmpdir(), `content-${label.toLowerCase()}-${Date.now()}.md`);
  fs.writeFileSync(file, text);

  try {
    const result = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
    if (result.status !== 0) return undefined;

    return fs.readFileSync(file, 'utf8').trim() || undefined;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function editText(
  rl: readline.Interface,
  post: PostRecord,
): Promise<PlatformText> {
  const edited: PlatformText = { ...post.drafts };
  const hasEditor = Boolean(process.env.EDITOR ?? process.env.VISUAL);

  for (const platform of PLATFORM_ORDER) {
    const draft = post.drafts[platform];
    if (!draft) continue;

    const label = PLATFORM_LABELS[platform];

    if (hasEditor) {
      const answer = await askText(rl, `Edit ${label} in $EDITOR? [y/N] `);
      if (answer.toLowerCase() !== 'y') continue;

      const updated = editInEditor(label, draft);
      if (updated) edited[platform] = updated;
      continue;
    }

    const answer = await askText(
      rl,
      `Edit ${label}? Paste a single-line replacement, or press enter to keep.\n` +
        '(Set $EDITOR for multi-line editing.)\n',
    );
    if (answer) edited[platform] = answer;
  }

  return edited;
}

function isEdited(drafts: PlatformText, approved: PlatformText): boolean {
  return PLATFORM_ORDER.some((platform) => drafts[platform] !== approved[platform]);
}

async function main(): Promise<void> {
  const pending = await ledger.pendingReview();

  if (!pending.length) {
    console.log('✅ Nothing waiting for review.');
    return;
  }

  console.log(`${pending.length} post(s) awaiting review.`);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    for (const post of pending) {
      show(post);

      const choice = await ask(
        rl,
        '\n[a]ccept  [e]dit  [r]eject  [s]kip  [q]uit > ',
        ['a', 'e', 'r', 's', 'q'],
        's',
      );

      if (choice === 'q') break;
      if (choice === 's') continue;

      let decision: ReviewDecision;
      let approved: PlatformText | undefined;

      if (choice === 'r') {
        decision = 'rejected';
      } else if (choice === 'e') {
        approved = await editText(rl, post);
        decision = isEdited(post.drafts, approved) ? 'edited' : 'accepted';
      } else {
        decision = 'accepted';
        approved = { ...post.drafts };
      }

      // Asked on every path, including acceptance: "why this worked" is as
      // useful to the voice profile as "why this didn't".
      const critique = await askText(rl, 'Critique (optional, improves future posts): ');

      const updated = await ledger.recordReview(
        post.id,
        { decision, critique: critique || undefined, reviewedAt: new Date().toISOString() },
        approved,
      );

      if (decision === 'rejected') {
        console.log('🗑️  Rejected — kept in the ledger as training signal.');
        continue;
      }

      // Defaults to 'later': no keystroke, and no accidental publish.
      const when = await ask(
        rl,
        'Publish [n]ow, [s]chedule next slot, or [l]ater? > ',
        ['n', 's', 'l'],
        'l',
      );

      if (when === 'n' || when === 's') {
        const scheduledFor = when === 's' ? nextSlot() : undefined;
        const publications = await publishRecord(updated, { scheduledFor });
        describePublications(publications);
      } else {
        console.log('📥 Approved and held. `npm run publish-approved` sends it out.');
      }
    }
  } finally {
    rl.close();
  }
}

runCli(main);
