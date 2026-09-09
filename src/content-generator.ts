import Anthropic from '@anthropic-ai/sdk';
import type { GeneratedPosts, GenerationOptions, VoiceProfile } from './types.js';
import { renderProfile } from './voice-profile.js';
import { findNearestDuplicate, type SimilarityHit } from './dedupe.js';
import { GENERATION_EFFORT, LINKEDIN_MAX_LENGTH, MODEL, X_MAX_LENGTH } from './config.js';

const POSTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['xPost', 'linkedInPost'],
  properties: {
    xPost: { type: 'string' },
    linkedInPost: { type: 'string' },
  },
} as const;

/**
 * The closest prior post to either platform's draft.
 *
 * Both are checked: only the LinkedIn post used to be, and the short X posts
 * are the formulaic ones most likely to repeat.
 */
function worstClash(posts: GeneratedPosts, priorPosts: string[]): SimilarityHit | undefined {
  return [
    findNearestDuplicate(posts.linkedInPost, priorPosts),
    findNearestDuplicate(posts.xPost, priorPosts),
  ]
    .filter((hit): hit is SimilarityHit => hit !== undefined)
    .sort((a, b) => b.score - a.score)[0];
}

export class ContentGenerator {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  /**
   * Write a post for each platform in the author's voice.
   *
   * Takes a distilled `VoiceProfile` rather than a raw corpus. The profile is
   * rendered first and cached, so repeated generations pay for those tokens
   * once per cache window instead of on every call.
   */
  async generatePosts(
    profile: VoiceProfile,
    topic: string,
    options: GenerationOptions = {},
  ): Promise<GeneratedPosts> {
    if (!topic.trim()) throw new Error('Topic cannot be empty');

    const {
      xMaxLength = X_MAX_LENGTH,
      linkedInMaxLength = LINKEDIN_MAX_LENGTH,
      avoidSimilarTo = [],
    } = options;

    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text:
          'You write social posts in a specific person\'s voice, described below. ' +
          'Follow the voice profile exactly — it is the product. Never write a post ' +
          'that reads like generic thought-leadership.\n\n' +
          renderProfile(profile),
        // Stable prefix: cached across calls. Anything varying per-request goes
        // in the user turn below, never here, or the cache never hits.
        cache_control: { type: 'ephemeral' },
      },
    ];

    const instructions = [
      `Write two posts about: "${topic}"`,
      '',
      `1. xPost — at most ${xMaxLength} characters. Short and punchy.`,
      `2. linkedInPost — at most ${linkedInMaxLength} characters. Longer, with a story.`,
    ];

    if (avoidSimilarTo.length) {
      instructions.push(
        '',
        'You have already published the posts below. Do not repeat their angle, ' +
          'opening line, or central metaphor — find a genuinely different way in.',
        ...avoidSimilarTo.map((post, i) => `\nPrevious ${i + 1}:\n${post}`),
      );
    }

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: GENERATION_EFFORT,
        // Schema-enforced output. Replaces stripping markdown fences and
        // regex-matching for a JSON object, which failed on any stray prose.
        format: { type: 'json_schema', schema: POSTS_SCHEMA },
      },
      system,
      messages: [{ role: 'user', content: instructions.join('\n') }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Generation refused: ${response.stop_details?.explanation ?? 'unknown'}`);
    }

    // A cache read of zero across repeated runs means the stable prefix picked
    // up something that varies per request, and the profile is being paid for
    // in full every time.
    if (process.env.DEBUG_USAGE === 'true') {
      const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } =
        response.usage;
      console.log(
        `🔢 tokens — uncached in ${input_tokens}, cache write ${cache_creation_input_tokens ?? 0}, ` +
          `cache read ${cache_read_input_tokens ?? 0}, out ${output_tokens}`,
      );
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('');

    const posts = JSON.parse(text) as GeneratedPosts;

    if (posts.xPost.length > xMaxLength) {
      console.warn(`⚠️  X post is ${posts.xPost.length} chars (limit ${xMaxLength})`);
    }

    return posts;
  }

  /**
   * Generate, and retry once if the result restates something already published.
   *
   * A single retry is deliberate: the model gets one explicit correction, and a
   * near-duplicate that survives it is surfaced rather than silently shipped.
   */
  async generateDistinctPosts(
    profile: VoiceProfile,
    topic: string,
    priorPosts: string[],
    options: GenerationOptions = {},
  ): Promise<{ posts: GeneratedPosts; duplicateWarning?: string }> {
    const first = await this.generatePosts(profile, topic, {
      ...options,
      avoidSimilarTo: priorPosts.slice(-5),
    });

    const clash = worstClash(first, priorPosts);
    if (!clash) return { posts: first };

    console.warn(
      `♻️  Draft overlaps an earlier post (${(clash.score * 100).toFixed(0)}%). Regenerating once...`,
    );

    const second = await this.generatePosts(profile, topic, {
      ...options,
      avoidSimilarTo: [clash.text, ...priorPosts.slice(-4)],
    });

    const stillClashing = worstClash(second, priorPosts);

    return {
      posts: second,
      duplicateWarning: stillClashing
        ? `Still ${(stillClashing.score * 100).toFixed(0)}% similar to a previous post after retry`
        : undefined,
    };
  }
}
