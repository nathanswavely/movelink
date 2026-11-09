/**
 * Time on a Move. Shifts are written in wall-clock time where the Move happens
 * ('2026-11-14T09:00' in America/New_York), because that is how anyone says them; the
 * instants are worked out here, once per write, so the cron can compare numbers. Pure,
 * so scripts/test-rules.ts can check it without a Worker.
 */

export const DAY = 86_400;
/** A Move is forgotten this long after its last Shift ends (ADR-0001). */
export const FORGET_AFTER = 30 * DAY;
/** A Helper cancelling a Shift this close to it tells the Organizers. */
export const LATE_CANCEL = 2 * DAY;
/** The evening-before emails go from this hour, the day before a Shift. */
export const REMIND_HOUR = 18;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isLocal(s: string): boolean {
  const m = LOCAL.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60;
}

export function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** How far ahead of UTC `tz` is at this instant, in milliseconds. */
function offset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant (unix seconds) a wall-clock time in `tz` names. In the hour a spring-forward
 * skips, the time an hour later; in the hour a fall-back repeats, the first of the two.
 */
export function toInstant(local: string, tz: string): number {
  const m = LOCAL.exec(local);
  if (!m) throw new Error(`not a local time: ${local}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const first = asUtc - offset(asUtc, tz);
  const second = asUtc - offset(first, tz);
  // A repeated hour: both readings are real; keep the earlier.
  const earlier = Math.min(first, second);
  const t = toLocal(earlier / 1000, tz) === local ? earlier : Math.max(first, second);
  return Math.floor(t / 1000);
}

/** The wall-clock time in `tz` at this instant, as 'YYYY-MM-DDTHH:MM'. */
export function toLocal(seconds: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(seconds * 1000));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

/** The day before a local date ('2026-11-14' -> '2026-11-13'). */
export function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** When the evening-before emails for a Shift starting at this local time go. */
export function remindAt(starts: string, tz: string): number {
  return toInstant(`${dayBefore(starts.slice(0, 10))}T${String(REMIND_HOUR).padStart(2, '0')}:00`, tz);
}

/** When a Move is forgotten: 30 days after its last Shift ends, or after it was started if it has none. */
export function forgetAt(lastEndsAt: number | null, createdAt: number): number {
  return (lastEndsAt ?? createdAt) + FORGET_AFTER;
}

/** Is cancelling a Shift that starts at this instant late enough to tell the Organizers? */
export function isLateCancel(startsAt: number, now: number): boolean {
  return startsAt > now && startsAt - now <= LATE_CANCEL;
}

/** Is the evening-before email for a Shift due now? */
export function reminderDue(shift: { remindAt: number; startsAt: number }, now: number): boolean {
  return now >= shift.remindAt && now < shift.startsAt;
}

/** "Sat, Nov 14" */
export function dayLabel(local: string): string {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "9am", "12:30pm" */
export function clockLabel(local: string): string {
  const [h, mi] = local.slice(11, 16).split(':').map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}${mi ? `:${String(mi).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** "Sat, Nov 14, 9am–12pm" (or across days, both dates). */
export function spanLabel(starts: string, ends: string): string {
  const sameDay = starts.slice(0, 10) === ends.slice(0, 10);
  return sameDay
    ? `${dayLabel(starts)}, ${clockLabel(starts)}–${clockLabel(ends)}`
    : `${dayLabel(starts)} ${clockLabel(starts)} – ${dayLabel(ends)} ${clockLabel(ends)}`;
}

/** "Dec 14" */
export function dateLabel(seconds: number, tz: string): string {
  return new Date(seconds * 1000).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
}
