import Anthropic from '@anthropic-ai/sdk';
import type { LearnedRule, PostRecord, VoiceProfile } from './types.js';
import { document } from './store.js';
import { fingerprint, selectExemplars } from './corpus.js';
import { DISTILL_EFFORT, MAX_LEARNED_RULES, MODEL } from './config.js';

export const profileStore = document<VoiceProfile>('voice-profile');

const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'rules', 'vocabulary', 'structures'],
  properties: {
    summary: {
      type: 'string',
      description: 'Two to four sentences describing how this person writes.',
    },
    rules: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Six to twelve concrete, checkable style rules. Each must be specific enough ' +
        'that a reader could point at a sentence and say whether it complies.',
    },
    vocabulary: {
      type: 'object',
      additionalProperties: false,
      required: ['favors', 'avoids'],
      properties: {
        favors: { type: 'array', items: { type: 'string' } },
        avoids: { type: 'array', items: { type: 'string' } },
      },
    },
    structures: {
      type: 'array',
      items: { type: 'string' },
      description: 'Recurring post shapes, described as templates.',
    },
  },
} as const;

/**
 * Turn a raw corpus into a distilled, reusable voice profile.
 *
 * Run once per corpus change rather than once per post. The old path shipped
 * all 58 posts (~19k tokens) on every single generation; this ships a few
 * hundred tokens of distilled rules instead, and produces a sharper voice
 * because the model is given an analysis rather than asked to infer one
 * under time pressure.
 */
export async function distillVoiceProfile(
  posts: string[],
  client: Anthropic = new Anthropic(),
): Promise<VoiceProfile> {
  if (!posts.length) {
    throw new Error('Cannot distil a voice profile from an empty corpus');
  }

  const numbered = posts.map((post, i) => `--- Post ${i + 1} ---\n${post}`).join('\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: DISTILL_EFFORT,
      format: { type: 'json_schema', schema: PROFILE_SCHEMA },
    },
    system:
      'You are a writing analyst. You read a corpus of one person\'s social posts and ' +
      'produce a precise, reusable description of their voice. Describe what is ' +
      'distinctive and reproducible, not what is generic to the platform. Be specific: ' +
      '"opens with a three-word sentence fragment" beats "is punchy".',
    messages: [
      {
        role: 'user',
        content: `Analyse the voice in these ${posts.length} posts.\n\n${numbered}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Distillation refused: ${response.stop_details?.explanation ?? 'unknown'}`);
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as Anthropic.TextBlock).text)
    .join('');

  const analysis = JSON.parse(text) as Pick<
    VoiceProfile,
    'summary' | 'rules' | 'vocabulary' | 'structures'
  >;

  const sourceFingerprint = fingerprint(posts);

  return {
    version: `${sourceFingerprint}-${Date.now().toString(36)}`,
    builtAt: new Date().toISOString(),
    sourceFingerprint,
    sourcePostCount: posts.length,
    model: MODEL,
    ...analysis,
    exemplars: selectExemplars(posts),
    learned: [],
  };
}

/** True when the corpus has moved on since the profile was built. */
export function isStale(profile: VoiceProfile, posts: string[]): boolean {
  return profile.sourceFingerprint !== fingerprint(posts);
}

/**
 * Render the profile as the stable prefix of a generation prompt.
 *
 * Kept deterministic — no timestamps, no shuffling — because any byte change
 * here invalidates the prompt cache for every subsequent call.
 */
export function renderProfile(profile: VoiceProfile): string {
  const sections = [
    `VOICE SUMMARY\n${profile.summary}`,
    `STYLE RULES\n${profile.rules.map((r) => `- ${r}`).join('\n')}`,
    `WORDS AND PHRASES THIS PERSON USES\n${profile.vocabulary.favors.join(', ')}`,
    `WORDS AND PHRASES THIS PERSON AVOIDS\n${profile.vocabulary.avoids.join(', ')}`,
    `RECURRING POST STRUCTURES\n${profile.structures.map((s) => `- ${s}`).join('\n')}`,
    `REPRESENTATIVE POSTS\n${profile.exemplars
      .map((post, i) => `Example ${i + 1}:\n${post}`)
      .join('\n\n')}`,
  ];

  if (profile.learned.length) {
    sections.push(
      `LEARNED FROM PUBLISHED RESULTS AND REVIEW\n` +
        `These override the general rules above where they conflict.\n` +
        profile.learned.map((l) => `- ${l.rule}`).join('\n'),
    );
  }

  return sections.join('\n\n');
}

const REFINEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rules'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'source', 'evidence'],
        properties: {
          rule: { type: 'string', description: 'An actionable instruction for future posts.' },
          source: { type: 'string', enum: ['review', 'engagement'] },
          evidence: { type: 'string', description: 'The specific observation behind the rule.' },
        },
      },
    },
  },
} as const;

/**
 * The loop that was missing: turn review decisions and measured engagement
 * into rules that change what gets written next.
 *
 * Called with the ledger's history rather than a single post, so a rule has to
 * be supported by a pattern before it earns a place in the profile.
 */
export async function refineVoiceProfile(
  profile: VoiceProfile,
  history: PostRecord[],
  client: Anthropic = new Anthropic(),
): Promise<VoiceProfile> {
  const reviewed = history.filter((record) => record.review);
  const measured = history.filter((record) => record.outcomes.length);

  if (reviewed.length + measured.length === 0) {
    return profile;
  }

  const reviewEvidence = reviewed
    .map((record) => {
      const parts = [`Topic: ${record.topic}`, `Decision: ${record.review!.decision}`];
      if (record.review!.critique) parts.push(`Critique: ${record.review!.critique}`);
      if (record.review!.decision === 'edited' && record.approved) {
        for (const platform of Object.keys(record.approved) as (keyof typeof record.approved)[]) {
          parts.push(
            `Model wrote (${platform}): ${record.drafts[platform]}`,
            `Human published (${platform}): ${record.approved[platform]}`,
          );
        }
      }
      return parts.join('\n');
    })
    .join('\n\n---\n\n');

  const engagementEvidence = measured
    .map((record) => {
      const totals = record.outcomes
        .map(
          (o) =>
            `${o.platform}: ${o.impressions ?? '?'} impressions, ${o.likes ?? '?'} likes, ` +
            `${o.comments ?? '?'} comments, engagement rate ${o.engagementRate ?? '?'}`,
        )
        .join('; ');
      const text = record.approved?.linkedin ?? record.drafts.linkedin ?? record.drafts.twitter ?? '';
      return `Topic: ${record.topic}\nResults: ${totals}\nPost: ${text}`;
    })
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: DISTILL_EFFORT,
      format: { type: 'json_schema', schema: REFINEMENT_SCHEMA },
    },
    system:
      'You improve a writing-voice profile using evidence from posts that were ' +
      'reviewed by the author and measured in the wild. Propose only rules supported ' +
      'by a repeated pattern across several posts — never generalise from one data ' +
      'point, and never restate a rule the profile already contains. If the evidence ' +
      'does not support any new rule, return an empty list. Prefer few strong rules.',
    messages: [
      {
        role: 'user',
        content: [
          'CURRENT PROFILE',
          renderProfile(profile),
          '',
          'AUTHOR REVIEW DECISIONS',
          reviewEvidence || '(none yet)',
          '',
          'MEASURED ENGAGEMENT',
          engagementEvidence || '(none yet)',
        ].join('\n'),
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Refinement refused: ${response.stop_details?.explanation ?? 'unknown'}`);
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as Anthropic.TextBlock).text)
    .join('');

  const { rules } = JSON.parse(text) as { rules: Omit<LearnedRule, 'addedAt'>[] };
  const addedAt = new Date().toISOString();

  // Bounded, oldest-first eviction. Learned rules sit inside the cached prompt
  // prefix, so an append-only list would grow the cost of every generation
  // forever and let stale rules contradict newer evidence indefinitely.
  const learned = [...profile.learned, ...rules.map((rule) => ({ ...rule, addedAt }))];
  const retired = Math.max(0, learned.length - MAX_LEARNED_RULES);

  if (retired) {
    console.log(`   ♻️  Retired ${retired} of the oldest rule(s) to stay within ${MAX_LEARNED_RULES}.`);
  }

  return { ...profile, learned: learned.slice(-MAX_LEARNED_RULES) };
}
