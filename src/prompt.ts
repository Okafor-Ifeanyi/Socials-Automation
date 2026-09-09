import type * as readline from 'readline/promises';

/**
 * Console prompting, kept in its own module so it can be tested without
 * importing a CLI (every entry point runs `main()` on import).
 */

/**
 * Ask a question, resolving to `undefined` if stdin closes first.
 *
 * `readline.question()` never settles once stdin hits EOF — the event loop
 * drains and the process exits mid-review with no output and status 0. Racing
 * the close event makes non-interactive runs deterministic.
 */
function questionOrEof(
  rl: readline.Interface,
  prompt: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      rl.off('close', onClose);
      resolve(value);
    };

    const onClose = () => finish(undefined);
    rl.once('close', onClose);

    rl.question(prompt).then(
      (answer) => finish(answer),
      () => finish(undefined),
    );
  });
}

/**
 * Prompt until the answer is one of `allowed`.
 *
 * `onEmpty` is what a bare Enter or a closed stdin resolves to, and every
 * caller states it explicitly. Deriving it from the key letters meant 's' was
 * "skip" at one prompt and "schedule" — a live publish — at another, so
 * pressing Enter could post to real accounts.
 */
export async function ask(
  rl: readline.Interface,
  prompt: string,
  allowed: string[],
  onEmpty: string,
): Promise<string> {
  if (!allowed.includes(onEmpty)) {
    throw new Error(`Default "${onEmpty}" is not one of: ${allowed.join(', ')}`);
  }

  for (;;) {
    const answer = await questionOrEof(rl, prompt);
    if (answer === undefined) return onEmpty;

    const choice = answer.trim().toLowerCase();
    if (allowed.includes(choice)) return choice;
    if (!choice) return onEmpty;

    console.log(`   Please choose one of: ${allowed.join(', ')}`);
  }
}

/**
 * Free-text prompt. Resolves to '' if stdin closes, so a non-interactive run
 * finishes its work instead of exiting silently part-way through.
 */
export async function askText(rl: readline.Interface, prompt: string): Promise<string> {
  return (await questionOrEof(rl, prompt))?.trim() ?? '';
}
