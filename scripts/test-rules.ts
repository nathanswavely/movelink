/**
 * MoveLink's time rules, without a Worker (`npm test`): wall-clock to instants across
 * daylight saving, the evening-before reminder, the forget date and the late-cancel
 * window. Exits non-zero on the first broken rule.
 */
import { dayBefore, forgetAt, isLateCancel, isLocal, remindAt, reminderDue, spanLabel, toInstant, toLocal, DAY } from '../src/lib/time.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) { failures++; console.error('FAIL', what); }
};
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16);
const NY = 'America/New_York';

// Plain days, both sides of DST.
check(iso(toInstant('2026-11-14T09:00', NY)) === '2026-11-14T14:00', 'Nov 14 9am in New York is 14:00Z (EST)');
check(iso(toInstant('2026-07-04T09:00', NY)) === '2026-07-04T13:00', 'Jul 4 9am in New York is 13:00Z (EDT)');
check(iso(toInstant('2026-11-14T09:00', 'America/Los_Angeles')) === '2026-11-14T17:00', 'Los Angeles too');
check(iso(toInstant('2026-11-14T09:00', 'UTC')) === '2026-11-14T09:00', 'and UTC');

// The spring-forward gap (2026-03-08 02:00 -> 03:00): 2:30 does not exist; an hour later.
check(toLocal(toInstant('2026-03-08T02:30', NY), NY) === '2026-03-08T03:30', 'a time in the skipped hour lands an hour later');
// The fall-back repeat (2026-11-01 01:00-02:00 happens twice): the first.
check(iso(toInstant('2026-11-01T01:30', NY)) === '2026-11-01T05:30', 'a time in the repeated hour is the first of the two (EDT)');
check(iso(toInstant('2026-11-01T03:00', NY)) === '2026-11-01T08:00', 'after the repeat, EST');

// Round trips over a year of hours.
for (let t = toInstant('2026-01-01T00:00', NY); t < toInstant('2027-01-01T00:00', NY); t += 3600) {
  const local = toLocal(t, NY);
  const back = toInstant(local, NY);
  // Only the repeated hour may come back an hour early.
  check(back === t || back === t - 3600, `round trip at ${iso(t)}`);
}

check(isLocal('2026-11-14T09:00') && !isLocal('2026-02-30T09:00') && !isLocal('2026-11-14 09:00') && !isLocal('2026-11-14T24:00'), 'local times are checked');
check(dayBefore('2026-03-01') === '2026-02-28' && dayBefore('2026-01-01') === '2025-12-31', 'the day before crosses months and years');

// The evening before: 18:00 local, whatever the season.
check(toLocal(remindAt('2026-11-14T09:00', NY), NY) === '2026-11-13T18:00', 'reminder at 6pm the evening before');
check(toLocal(remindAt('2026-03-08T09:00', NY), NY) === '2026-03-07T18:00', 'the evening before a spring-forward morning');
const shift = { remindAt: remindAt('2026-11-14T09:00', NY), startsAt: toInstant('2026-11-14T09:00', NY) };
check(!reminderDue(shift, shift.remindAt - 1), 'not due before 6pm');
check(reminderDue(shift, shift.remindAt) && reminderDue(shift, shift.startsAt - 1), 'due from 6pm until it starts');
check(!reminderDue(shift, shift.startsAt), 'not once it has started');

// Forgotten 30 days after the last Shift ends, or after it was started if it has none.
check(forgetAt(1_000_000, 0) === 1_000_000 + 30 * DAY, 'forgotten 30 days after the last Shift');
check(forgetAt(null, 5) === 5 + 30 * DAY, 'a Move with no Shifts, 30 days after it was started');

// Cancelling late: within 48 hours before it starts, not after.
const start = 10 * DAY;
check(isLateCancel(start, start - 2 * DAY), 'exactly 48 hours before is late');
check(!isLateCancel(start, start - 2 * DAY - 1), 'a second more is not');
check(!isLateCancel(start, start), 'once it starts it is not a cancellation');

check(spanLabel('2026-11-14T09:00', '2026-11-14T12:30') === 'Sat, Nov 14, 9am–12:30pm', `a span reads well (${spanLabel('2026-11-14T09:00', '2026-11-14T12:30')})`);
check(spanLabel('2026-11-14T00:00', '2026-11-14T12:00') === 'Sat, Nov 14, 12am–12pm', 'midnight and noon');

if (failures) {
  console.error(`rules: ${failures} broken`);
  process.exit(1);
}
console.log('rules: all hold');
