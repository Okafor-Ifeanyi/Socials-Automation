import { closePool } from './db.js';

/**
 * Run a command-line entrypoint to completion.
 *
 * The `finally` is the point: an open Postgres pool holds the event loop open,
 * so without releasing it every command prints its last line and then appears
 * to hang for the idle timeout. `process.exitCode` rather than `process.exit`
 * for the same reason — exiting outright would skip the cleanup and truncate
 * buffered output.
 */
export function runCli(main: () => Promise<void>, lead = '❌ '): void {
  main()
    .catch((error: Error) => {
      console.error(`${lead}${error.message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}
