import type { Notice } from '@swavely-lol/kit/contract';
import { loadMove, markSent, movesWithRemindersDue, type Helper, type MoveFull, type Shift } from './data';
import { reminderDue, spanLabel } from './time';

/**
 * MoveLink's emails, all sent by the Hub (swavely-lol ADR-0001) and only to People:
 * Organizers, and Helpers who are People. A Helper with only a name gets nothing; the
 * Organizers text them.
 *
 * - The evening before a Shift: each Helper on it a reminder, the Organizers a summary.
 * - A Helper cancelling within 48 hours of a Shift: the Organizers.
 * - An Organizer moving a Shift, or removing a Helper: the Helpers it touches.
 *
 * Never one per sign-up: the Organizer's page shows those.
 */

const linkPath = (m: MoveFull) => `/move/l/${m.link}`;
const organizerPath = (m: MoveFull) => `/move/m/${m.id}`;
const placeOf = (m: MoveFull, s: Shift) => m.places.find((p) => p.id === s.placeId);
const names = (list: string[]) => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

function shiftLine(m: MoveFull, s: Shift): string {
  const p = placeOf(m, s);
  return `${s.job}, ${spanLabel(s.starts, s.ends)}${p ? `, at the ${p.label}: ${p.address}` : ''}`;
}

/** The evening-before emails that are due, each sent once (sent_notices). */
export async function sendReminders(env: ToolEnv, at = Math.floor(Date.now() / 1000)): Promise<number> {
  let sent = 0;
  for (const move of await movesWithRemindersDue(env.DB, at)) {
    const m = await loadMove(env.DB, move);
    const due = m.shifts.filter((s) => reminderDue(s, at));
    const days = new Map<string, Shift[]>();
    for (const s of due) days.set(s.starts.slice(0, 10), [...(days.get(s.starts.slice(0, 10)) ?? []), s]);
    const organizers = await env.HUB.people(m.organizerIds);
    const organizerNames = organizers.map((p) => p.name);

    for (const [day, shifts] of days) {
      // Each Helper who is a Person, once for the day, with every Shift of theirs on it.
      const helpers = new Map<string, { helper: Helper; shifts: Shift[] }>();
      for (const s of shifts) {
        for (const hid of m.signups.get(s.id) ?? []) {
          const h = m.helpers.find((x) => x.id === hid);
          if (!h?.personId) continue;
          const entry = helpers.get(h.id) ?? { helper: h, shifts: [] };
          entry.shifts.push(s);
          helpers.set(h.id, entry);
        }
      }
      for (const { helper, shifts: theirs } of helpers.values()) {
        if (!(await markSent(env.DB, `helper:${helper.id}:${day}`, m.id))) continue;
        await env.HUB.notify([helper.personId!], helperReminder(m, helper, theirs, organizerNames));
        sent++;
      }
      if (await markSent(env.DB, `organizers:${m.id}:${day}`, m.id)) {
        const all = m.shifts.filter((s) => s.starts.slice(0, 10) === day);
        await env.HUB.notify(m.organizerIds, organizerSummary(m, all));
        sent++;
      }
    }
  }
  return sent;
}

function helperReminder(m: MoveFull, h: Helper, shifts: Shift[], organizerNames: string[]): Notice {
  const lines = [`Thanks for helping with ${m.title} tomorrow.`, ...shifts.map((s) => shiftLine(m, s))];
  const notes = [...new Set(shifts.map((s) => placeOf(m, s)).filter((p) => p?.note).map((p) => `${p!.label}: ${p!.note}`))];
  lines.push(...notes);
  const bringing = m.needs.filter((n) => n.takenBy === h.id).map((n) => n.label);
  const adding = m.pitchIns.flatMap((p) => {
    const amount = m.shares.get(p.id)?.get(h.id);
    return amount ? [`about ${amount} ${p.label.toLowerCase()}`] : [];
  });
  const things = [...bringing, ...adding];
  if (things.length) lines.push(`You said you'd bring ${names(things)}.`);
  if (organizerNames.length) lines.push(`${names(organizerNames)} ${organizerNames.length === 1 ? 'is' : 'are'} running it.`);
  return { subject: `Tomorrow: ${m.title}`, lines, cta: { label: 'See the move', path: linkPath(m) } };
}

function organizerSummary(m: MoveFull, shifts: Shift[]): Notice {
  const lines = [`Here's who's coming to ${m.title} tomorrow.`];
  for (const s of shifts) {
    const who = (m.signups.get(s.id) ?? []).map((id) => m.helpers.find((h) => h.id === id)?.name).filter(Boolean) as string[];
    const count = `${who.length} of ${s.wanted}${who.length < s.wanted ? ', still short' : ''}`;
    lines.push(`${shiftLine(m, s)}: ${count}${who.length ? ` (${names(who)})` : ''}`);
  }
  const open = m.needs.filter((n) => !n.takenBy).map((n) => n.label);
  if (open.length) lines.push(`Nobody has taken: ${names(open)}.`);
  for (const p of m.pitchIns) {
    const total = [...(m.shares.get(p.id)?.values() ?? [])].reduce((a, b) => a + b, 0);
    lines.push(`${p.label}: about ${total}${p.goal ? ` of ${p.goal}` : ''}.`);
  }
  return { subject: `Tomorrow's crew: ${m.title}`, lines, cta: { label: 'Open the move', path: organizerPath(m) } };
}

/** A Helper dropped Shifts that start within 48 hours. */
export async function tellLateCancel(env: ToolEnv, m: MoveFull, helperName: string, shifts: Shift[]) {
  if (!shifts.length) return;
  const lines = [`${helperName} can't make it anymore:`];
  for (const s of shifts) {
    const left = (m.signups.get(s.id) ?? []).length - 1;
    lines.push(`${shiftLine(m, s)}. Now ${Math.max(0, left)} of ${s.wanted}.`);
  }
  await env.HUB.notify(m.organizerIds, { subject: `${helperName} can't make ${m.title}`, lines, cta: { label: 'Open the move', path: organizerPath(m) } });
}

/** An Organizer moved a Shift: the Helpers on it who are People. */
export async function tellShiftMoved(env: ToolEnv, m: MoveFull, shift: Shift) {
  const people = (m.signups.get(shift.id) ?? []).map((id) => m.helpers.find((h) => h.id === id)?.personId).filter((p): p is string => !!p);
  if (!people.length) return;
  await env.HUB.notify(people, {
    subject: `A shift you're on changed: ${m.title}`,
    lines: [`The shift you signed up for on ${m.title} changed. It's now:`, shiftLine(m, shift), 'If that no longer works, you can change your answer.'],
    cta: { label: 'See the move', path: linkPath(m) },
  });
}

/** An Organizer took a Helper off the Move. */
export async function tellHelperRemoved(env: ToolEnv, m: MoveFull, h: Helper) {
  if (!h.personId) return;
  await env.HUB.notify([h.personId], {
    subject: `You're off ${m.title}`,
    lines: [`Whoever's running ${m.title} took you off it, so you're not signed up for anything there anymore.`, 'If that was a mistake, ask them, or sign up again from the link.'],
  });
}
