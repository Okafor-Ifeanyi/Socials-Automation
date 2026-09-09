/** Central place for the knobs that used to be scattered as literals. */

/**
 * Read a numeric setting, failing loudly on a bad value.
 *
 * Plain `Number(process.env.X ?? default)` yields NaN for a malformed value,
 * and NaN comparisons are silently false — a typo in SIMILARITY_THRESHOLD
 * switched off duplicate detection with no error anywhere.
 */
export function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }

  return value;
}

/**
 * Anthropic model used for generation and distillation.
 * Was pinned to claude-sonnet-4-20250514, which is two generations old.
 */
export const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

/** Thinking depth. Generation is not a hard reasoning task; distillation is. */
export const GENERATION_EFFORT = (process.env.GENERATION_EFFORT ?? 'medium') as
  | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const DISTILL_EFFORT = (process.env.DISTILL_EFFORT ?? 'high') as
  | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const X_MAX_LENGTH = numberFromEnv('X_MAX_LENGTH', 280);
export const LINKEDIN_MAX_LENGTH = numberFromEnv('LINKEDIN_MAX_LENGTH', 3000);

/** IANA timezone the posting schedule is expressed in. */
export const TIMEZONE = process.env.POST_TIMEZONE ?? 'UTC';
/** Local hour of day to publish at. */
export const POST_HOUR = numberFromEnv('POST_HOUR', 9);

/** Jaccard similarity above which a draft counts as a repeat of an old post. */
export const SIMILARITY_THRESHOLD = numberFromEnv('SIMILARITY_THRESHOLD', 0.5);

/** How long to wait after publishing before engagement numbers are meaningful. */
export const OUTCOME_DELAY_HOURS = numberFromEnv('OUTCOME_DELAY_HOURS', 48);

/** Cap on accumulated voice rules; the oldest are retired past this. */
export const MAX_LEARNED_RULES = numberFromEnv('MAX_LEARNED_RULES', 25);

/** Require human approval before anything is published. */
export const REQUIRE_APPROVAL = process.env.REQUIRE_APPROVAL !== 'false';

/** Human-readable platform names for CLI output. */
export const PLATFORM_LABELS: Record<'twitter' | 'linkedin', string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
};
