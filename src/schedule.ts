import { POST_HOUR, TIMEZONE } from './config.js';

/**
 * What the wall clock reads in `timeZone` at a given instant.
 */
function partsIn(date: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    min: Number(parts.minute),
  };
}

/** Offset in minutes between `timeZone` and UTC at a given instant. */
function offsetMinutes(date: Date, timeZone: string): number {
  const { y, m, d, h, min } = partsIn(date, timeZone);
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  const truncatedToMinute = Math.floor(date.getTime() / 60_000) * 60_000;
  return (asUtc - truncatedToMinute) / 60_000;
}

/**
 * The next instant at which it is `hour`:00 local time in `timeZone`.
 *
 * The old implementation called `setHours` on a Date, which meant "9am wherever
 * this process happens to run" — UTC on a GitHub runner — and then always added
 * a day, so a Mon/Wed/Fri cron scheduled posts for Tue/Thu/Sat. This returns
 * today's slot when it is still ahead, and resolves the offset at the target
 * instant so it stays correct across DST boundaries.
 */
export function nextSlot(
  from: Date = new Date(),
  timeZone: string = TIMEZONE,
  hour: number = POST_HOUR,
): Date {
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const local = partsIn(new Date(from.getTime() + dayOffset * 86_400_000), timeZone);

    // Guess the instant assuming the offset we see now, then correct once using
    // the offset actually in force at that instant.
    const guess = new Date(Date.UTC(local.y, local.m - 1, local.d, hour, 0, 0));
    const corrected = new Date(guess.getTime() - offsetMinutes(new Date(guess), timeZone) * 60_000);

    if (corrected.getTime() > from.getTime()) return corrected;
  }

  throw new Error(`Could not resolve a posting slot for ${timeZone} at ${hour}:00`);
}
