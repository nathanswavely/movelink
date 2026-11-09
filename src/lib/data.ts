import { forgetAt, isLocal, remindAt, toInstant } from './time';

/**
 * MoveLink's data (CONTEXT.md). Every write that touches a Shift's time works out its
 * instants here, so nothing else has to. Ids are random and prefixed; People are the
 * Hub's, by id.
 */

const now = () => Math.floor(Date.now() / 1000);
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 16) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const newId = (prefix: string) => prefix + randomToken(12);

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const clean = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max);

export interface Move {
  id: string;
  title: string;
  notes: string | null;
  tz: string;
  link: string;
  createdBy: string;
  createdAt: number;
  /** When the last Shift ends, if there are any. */
  lastEndsAt: number | null;
  forgetAt: number;
}
export interface Place { id: string; label: string; address: string; note: string | null; position: number }
export interface Shift { id: string; placeId: string; job: string; starts: string; ends: string; startsAt: number; endsAt: number; remindAt: number; wanted: number }
export interface Helper { id: string; name: string; phone: string | null; note: string | null; personId: string | null; createdAt: number }
export interface Need { id: string; label: string; note: string | null; takenBy: string | null; offered: boolean }
export interface PitchIn { id: string; label: string; goal: number | null }

/** Everything on one Move, as its pages show it. */
export interface MoveFull extends Move {
  organizerIds: string[];
  places: Place[];
  shifts: Shift[];
  helpers: Helper[];
  /** shift id -> helper ids, in the order they signed up */
  signups: Map<string, string[]>;
  needs: Need[];
  pitchIns: PitchIn[];
  /** pitch-in id -> helper id -> amount */
  shares: Map<string, Map<string, number>>;
}

interface MoveRow { id: string; title: string; notes: string | null; tz: string; link: string; created_by: string; created_at: number; last_ends_at: number | null }
const MOVE = `SELECT m.id, m.title, m.notes, m.tz, m.link, m.created_by, m.created_at,
  (SELECT MAX(ends_at) FROM shifts s WHERE s.move_id = m.id) AS last_ends_at FROM moves m`;
const toMove = (r: MoveRow): Move => ({
  id: r.id, title: r.title, notes: r.notes, tz: r.tz, link: r.link, createdBy: r.created_by, createdAt: r.created_at,
  lastEndsAt: r.last_ends_at, forgetAt: forgetAt(r.last_ends_at, r.created_at),
});

/** Is the Move still to come: a Shift not yet over, or no Shifts yet? */
export const isUpcoming = (m: Move, at = now()) => m.lastEndsAt === null || m.lastEndsAt > at;

export async function createMove(db: D1Database, input: { title: string; tz: string; by: string }): Promise<string> {
  const id = newId('mv_');
  const t = now();
  await db.batch([
    db.prepare('INSERT INTO moves (id, title, notes, tz, link, created_by, created_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)').bind(id, input.title, input.tz, randomToken(), input.by, t),
    db.prepare('INSERT INTO move_organizers (move_id, person_id, added_at) VALUES (?1, ?2, ?3)').bind(id, input.by, t),
  ]);
  return id;
}

export async function getMove(db: D1Database, id: string): Promise<Move | null> {
  const r = await db.prepare(`${MOVE} WHERE m.id = ?1`).bind(id).first<MoveRow>();
  return r ? toMove(r) : null;
}

/** The Move a link opens, or that it used to open before it was replaced. */
export async function moveByLink(db: D1Database, link: string): Promise<{ move: Move | null; replaced: boolean }> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(link)) return { move: null, replaced: false };
  const [live, old] = await db.batch([
    db.prepare(`${MOVE} WHERE m.link = ?1`).bind(link),
    db.prepare('SELECT move_id FROM replaced_links WHERE link = ?1').bind(link),
  ]);
  const row = (live.results as MoveRow[])[0];
  return { move: row ? toMove(row) : null, replaced: !row && old.results.length > 0 };
}

/** Every piece of a Move, in one round trip. */
export async function loadMove(db: D1Database, move: Move): Promise<MoveFull> {
  const id = move.id;
  const [orgs, places, shifts, helpers, signups, needs, pitchIns, shares] = await db.batch([
    db.prepare('SELECT person_id FROM move_organizers WHERE move_id = ?1 ORDER BY added_at').bind(id),
    db.prepare('SELECT id, label, address, note, position FROM places WHERE move_id = ?1 ORDER BY position, rowid').bind(id),
    db.prepare('SELECT id, place_id, job, starts, ends, starts_at, ends_at, remind_at, wanted FROM shifts WHERE move_id = ?1 ORDER BY starts_at, rowid').bind(id),
    db.prepare('SELECT id, name, phone, note, person_id, created_at FROM helpers WHERE move_id = ?1 ORDER BY created_at, rowid').bind(id),
    db.prepare('SELECT ss.shift_id, ss.helper_id FROM shift_signups ss JOIN shifts s ON s.id = ss.shift_id WHERE s.move_id = ?1 ORDER BY ss.signed_at, ss.rowid').bind(id),
    db.prepare('SELECT id, label, note, taken_by, offered FROM needs WHERE move_id = ?1 ORDER BY offered, position, rowid').bind(id),
    db.prepare('SELECT id, label, goal FROM pitch_ins WHERE move_id = ?1 ORDER BY position, rowid').bind(id),
    db.prepare('SELECT ps.pitch_in_id, ps.helper_id, ps.amount FROM pitch_in_shares ps JOIN pitch_ins p ON p.id = ps.pitch_in_id WHERE p.move_id = ?1').bind(id),
  ]);
  type R = Record<string, unknown>;
  const rows = (r: D1Result) => r.results as R[];
  const signupMap = new Map<string, string[]>();
  for (const r of rows(signups)) {
    const list = signupMap.get(r.shift_id as string) ?? [];
    list.push(r.helper_id as string);
    signupMap.set(r.shift_id as string, list);
  }
  const shareMap = new Map<string, Map<string, number>>();
  for (const r of rows(shares)) {
    const m = shareMap.get(r.pitch_in_id as string) ?? new Map<string, number>();
    m.set(r.helper_id as string, r.amount as number);
    shareMap.set(r.pitch_in_id as string, m);
  }
  return {
    ...move,
    organizerIds: rows(orgs).map((r) => r.person_id as string),
    places: rows(places).map((r) => ({ id: r.id as string, label: r.label as string, address: r.address as string, note: r.note as string | null, position: r.position as number })),
    shifts: rows(shifts).map((r) => ({
      id: r.id as string, placeId: r.place_id as string, job: r.job as string, starts: r.starts as string, ends: r.ends as string,
      startsAt: r.starts_at as number, endsAt: r.ends_at as number, remindAt: r.remind_at as number, wanted: r.wanted as number,
    })),
    helpers: rows(helpers).map((r) => ({ id: r.id as string, name: r.name as string, phone: r.phone as string | null, note: r.note as string | null, personId: r.person_id as string | null, createdAt: r.created_at as number })),
    signups: signupMap,
    needs: rows(needs).map((r) => ({ id: r.id as string, label: r.label as string, note: r.note as string | null, takenBy: r.taken_by as string | null, offered: !!r.offered })),
    pitchIns: rows(pitchIns).map((r) => ({ id: r.id as string, label: r.label as string, goal: r.goal as number | null })),
    shares: shareMap,
  };
}

/** The Moves someone organizes, and the ones they help on as a Person. */
export async function movesOf(db: D1Database, personId: string): Promise<{ organizing: Move[]; helping: Move[] }> {
  const [org, help] = await db.batch([
    db.prepare(`${MOVE} WHERE m.id IN (SELECT move_id FROM move_organizers WHERE person_id = ?1) ORDER BY m.created_at DESC`).bind(personId),
    db.prepare(`${MOVE} WHERE m.id IN (SELECT move_id FROM helpers WHERE person_id = ?1)
      AND m.id NOT IN (SELECT move_id FROM move_organizers WHERE person_id = ?1) ORDER BY m.created_at DESC`).bind(personId),
  ]);
  return { organizing: (org.results as MoveRow[]).map(toMove), helping: (help.results as MoveRow[]).map(toMove) };
}

export async function isOrganizer(db: D1Database, moveId: string, personId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM move_organizers WHERE move_id = ?1 AND person_id = ?2').bind(moveId, personId).first());
}

// ---------------------------------------------------------------------------- Organizers

export async function updateMove(db: D1Database, id: string, input: { title: string; notes: string | null }) {
  await db.prepare('UPDATE moves SET title = ?1, notes = ?2 WHERE id = ?3').bind(input.title, input.notes, id).run();
}

/** A new Move link; the old one only says it was replaced. Helpers keep their answers. */
export async function replaceLink(db: D1Database, move: Move): Promise<string> {
  const link = randomToken();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO replaced_links (link, move_id, replaced_at) VALUES (?1, ?2, ?3)').bind(move.link, move.id, now()),
    db.prepare('UPDATE moves SET link = ?1 WHERE id = ?2').bind(link, move.id),
  ]);
  return link;
}

export async function addOrganizer(db: D1Database, moveId: string, personId: string) {
  await db.prepare('INSERT OR IGNORE INTO move_organizers (move_id, person_id, added_at) VALUES (?1, ?2, ?3)').bind(moveId, personId, now()).run();
}

/** Remove an Organizer, unless they are the last. */
export async function removeOrganizer(db: D1Database, moveId: string, personId: string): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM move_organizers WHERE move_id = ?1 AND person_id = ?2 AND (SELECT COUNT(*) FROM move_organizers WHERE move_id = ?1) > 1')
    .bind(moveId, personId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function savePlace(db: D1Database, moveId: string, input: { id?: string; label: string; address: string; note: string | null }) {
  if (input.id) {
    await db.prepare('UPDATE places SET label = ?1, address = ?2, note = ?3 WHERE id = ?4 AND move_id = ?5').bind(input.label, input.address, input.note, input.id, moveId).run();
  } else {
    await db
      .prepare('INSERT INTO places (id, move_id, label, address, note, position) VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COUNT(*) FROM places WHERE move_id = ?2))')
      .bind(newId('pl_'), moveId, input.label, input.address, input.note)
      .run();
  }
}

/** Delete a Place nobody's Shift is at. */
export async function deletePlace(db: D1Database, moveId: string, placeId: string): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM places WHERE id = ?1 AND move_id = ?2 AND NOT EXISTS (SELECT 1 FROM shifts WHERE place_id = ?1)')
    .bind(placeId, moveId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export interface ShiftInput { id?: string; placeId: string; job: string; starts: string; ends: string; wanted: number }

export function shiftProblem(input: ShiftInput, tz: string): string | null {
  if (!input.job) return 'Say what the Shift is for ("Load the truck").';
  if (!isLocal(input.starts) || !isLocal(input.ends)) return 'Give the Shift a day, a start and an end.';
  if (toInstant(input.ends, tz) <= toInstant(input.starts, tz)) return 'A Shift has to end after it starts.';
  if (!Number.isInteger(input.wanted) || input.wanted < 1 || input.wanted > 99) return 'Ask for between 1 and 99 people.';
  return null;
}

/**
 * Add or change a Shift. Returns, for a change, whether its time or Place moved, so the
 * page can tell the Helpers on it. A changed time also unsends its evening-before email.
 */
export async function saveShift(db: D1Database, move: Move, input: ShiftInput): Promise<{ moved: boolean }> {
  const startsAt = toInstant(input.starts, move.tz);
  const endsAt = toInstant(input.ends, move.tz);
  const remind = remindAt(input.starts, move.tz);
  const place = await db.prepare('SELECT 1 FROM places WHERE id = ?1 AND move_id = ?2').bind(input.placeId, move.id).first();
  if (!place) throw new Error('That Place is not on this Move.');
  if (!input.id) {
    await db
      .prepare('INSERT INTO shifts (id, move_id, place_id, job, starts, ends, starts_at, ends_at, remind_at, wanted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(newId('sh_'), move.id, input.placeId, input.job, input.starts, input.ends, startsAt, endsAt, remind, input.wanted)
      .run();
    return { moved: false };
  }
  const before = await db.prepare('SELECT place_id, starts, ends FROM shifts WHERE id = ?1 AND move_id = ?2').bind(input.id, move.id).first<{ place_id: string; starts: string; ends: string }>();
  if (!before) return { moved: false };
  await db
    .prepare('UPDATE shifts SET place_id = ?1, job = ?2, starts = ?3, ends = ?4, starts_at = ?5, ends_at = ?6, remind_at = ?7, wanted = ?8 WHERE id = ?9 AND move_id = ?10')
    .bind(input.placeId, input.job, input.starts, input.ends, startsAt, endsAt, remind, input.wanted, input.id, move.id)
    .run();
  const moved = before.place_id !== input.placeId || before.starts !== input.starts || before.ends !== input.ends;
  return { moved };
}

export async function deleteShift(db: D1Database, moveId: string, shiftId: string) {
  await db.prepare('DELETE FROM shifts WHERE id = ?1 AND move_id = ?2').bind(shiftId, moveId).run();
}

export async function addNeed(db: D1Database, moveId: string, label: string, note: string | null) {
  await db
    .prepare('INSERT INTO needs (id, move_id, label, note, position) VALUES (?1, ?2, ?3, ?4, (SELECT COUNT(*) FROM needs WHERE move_id = ?2))')
    .bind(newId('nd_'), moveId, label, note)
    .run();
}

export async function deleteNeed(db: D1Database, moveId: string, needId: string) {
  await db.prepare('DELETE FROM needs WHERE id = ?1 AND move_id = ?2').bind(needId, moveId).run();
}

export async function addPitchIn(db: D1Database, moveId: string, label: string, goal: number | null) {
  await db
    .prepare('INSERT INTO pitch_ins (id, move_id, label, goal, position) VALUES (?1, ?2, ?3, ?4, (SELECT COUNT(*) FROM pitch_ins WHERE move_id = ?2))')
    .bind(newId('pi_'), moveId, label, goal)
    .run();
}

export async function deletePitchIn(db: D1Database, moveId: string, pitchInId: string) {
  await db.prepare('DELETE FROM pitch_ins WHERE id = ?1 AND move_id = ?2').bind(pitchInId, moveId).run();
}

/** Every statement that deletes one Helper: their sign-ups, shares, offers; listed Needs go free. */
function helperDeletes(db: D1Database, where: string, ...binds: unknown[]): D1PreparedStatement[] {
  const ids = `SELECT id FROM helpers WHERE ${where}`;
  return [
    db.prepare(`DELETE FROM shift_signups WHERE helper_id IN (${ids})`).bind(...binds),
    db.prepare(`DELETE FROM pitch_in_shares WHERE helper_id IN (${ids})`).bind(...binds),
    db.prepare(`DELETE FROM needs WHERE offered = 1 AND taken_by IN (${ids})`).bind(...binds),
    db.prepare(`UPDATE needs SET taken_by = NULL WHERE taken_by IN (${ids})`).bind(...binds),
    db.prepare(`DELETE FROM helpers WHERE ${where}`).bind(...binds),
  ];
}

export async function removeHelper(db: D1Database, moveId: string, helperId: string) {
  await db.batch(helperDeletes(db, 'id = ?1 AND move_id = ?2', helperId, moveId));
}

/** Delete a Move and everything on it. */
export function moveDeletes(db: D1Database, where: string, ...binds: unknown[]): D1PreparedStatement[] {
  const ids = `SELECT id FROM moves WHERE ${where}`;
  return [
    db.prepare(`DELETE FROM shift_signups WHERE shift_id IN (SELECT id FROM shifts WHERE move_id IN (${ids}))`).bind(...binds),
    db.prepare(`DELETE FROM pitch_in_shares WHERE pitch_in_id IN (SELECT id FROM pitch_ins WHERE move_id IN (${ids}))`).bind(...binds),
    ...['needs', 'pitch_ins', 'shifts', 'places', 'helpers', 'move_organizers', 'replaced_links', 'sent_notices'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE move_id IN (${ids})`).bind(...binds),
    ),
    db.prepare(`DELETE FROM moves WHERE ${where}`).bind(...binds),
  ];
}

export async function deleteMove(db: D1Database, moveId: string) {
  await db.batch(moveDeletes(db, 'id = ?1', moveId));
}

// ------------------------------------------------------------------------------- Helpers

/**
 * The Helper this visitor is on a Move: by Person when signed in, else by the browser's
 * ml_helper cookie. A Person who signed up from this browser before signing in takes that
 * sign-up with them ("what they said comes with them").
 */
export async function currentHelper(db: D1Database, moveId: string, who: { personId?: string; browser?: string }): Promise<Helper | null> {
  const row = (r: Record<string, unknown> | null): Helper | null =>
    r ? { id: r.id as string, name: r.name as string, phone: r.phone as string | null, note: r.note as string | null, personId: r.person_id as string | null, createdAt: r.created_at as number } : null;
  const cols = 'id, name, phone, note, person_id, created_at';
  if (who.personId) {
    const mine = await db.prepare(`SELECT ${cols} FROM helpers WHERE move_id = ?1 AND person_id = ?2`).bind(moveId, who.personId).first();
    if (mine) return row(mine);
    if (who.browser) {
      const here = await db.prepare(`SELECT ${cols} FROM helpers WHERE move_id = ?1 AND browser = ?2 AND person_id IS NULL`).bind(moveId, who.browser).first();
      if (here) {
        await db.prepare('UPDATE helpers SET person_id = ?1 WHERE id = ?2').bind(who.personId, here.id).run();
        return { ...row(here)!, personId: who.personId };
      }
    }
    return null;
  }
  if (!who.browser) return null;
  return row(await db.prepare(`SELECT ${cols} FROM helpers WHERE move_id = ?1 AND browser = ?2 ORDER BY person_id IS NOT NULL LIMIT 1`).bind(moveId, who.browser).first());
}

export interface Answer {
  name: string;
  phone: string | null;
  note: string | null;
  shiftIds: string[];
  needIds: string[];
  shares: Map<string, number>;
  offer: string | null;
}

/**
 * Save a Helper's whole answer: who they are, which Shifts, which Needs, how much to each
 * Pitch-in, and anything they offer. A Need someone else took in the meantime stays
 * theirs. Returns the Helper's id and the Shifts they dropped, for the late-cancel email.
 */
export async function saveAnswer(
  db: D1Database,
  move: MoveFull,
  existing: Helper | null,
  who: { personId?: string; browser?: string },
  a: Answer,
): Promise<{ helperId: string; dropped: string[] }> {
  const helperId = existing?.id ?? newId('hp_');
  const t = now();
  const validShifts = new Set(move.shifts.map((s) => s.id));
  const validNeeds = new Set(move.needs.filter((n) => !n.offered || n.takenBy === helperId).map((n) => n.id));
  const validPitchIns = new Set(move.pitchIns.map((p) => p.id));
  const shiftIds = [...new Set(a.shiftIds)].filter((id) => validShifts.has(id));
  const needIds = [...new Set(a.needIds)].filter((id) => validNeeds.has(id));
  const before = existing ? [...move.signups].filter(([, hs]) => hs.includes(helperId)).map(([s]) => s) : [];
  const dropped = before.filter((s) => !shiftIds.includes(s));

  const stmts: D1PreparedStatement[] = [];
  if (existing) {
    stmts.push(db.prepare('UPDATE helpers SET name = ?1, phone = ?2, note = ?3 WHERE id = ?4').bind(a.name, a.phone, a.note, helperId));
  } else {
    stmts.push(
      db.prepare('INSERT INTO helpers (id, move_id, name, phone, note, person_id, browser, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(helperId, move.id, a.name, a.phone, a.note, who.personId ?? null, who.personId ? null : (who.browser ?? null), t),
    );
  }
  for (const s of dropped) stmts.push(db.prepare('DELETE FROM shift_signups WHERE shift_id = ?1 AND helper_id = ?2').bind(s, helperId));
  for (const s of shiftIds) stmts.push(db.prepare('INSERT OR IGNORE INTO shift_signups (shift_id, helper_id, signed_at) VALUES (?1, ?2, ?3)').bind(s, helperId, t));
  // Needs: let go of the ones no longer ticked, take the ticked ones nobody else has.
  stmts.push(
    db.prepare(`UPDATE needs SET taken_by = NULL WHERE move_id = ?1 AND taken_by = ?2 AND offered = 0${needIds.length ? ` AND id NOT IN (${needIds.map((_, i) => `?${i + 3}`).join(',')})` : ''}`)
      .bind(move.id, helperId, ...needIds),
  );
  for (const n of needIds) stmts.push(db.prepare('UPDATE needs SET taken_by = ?1 WHERE id = ?2 AND move_id = ?3 AND (taken_by IS NULL OR taken_by = ?1)').bind(helperId, n, move.id));
  for (const p of validPitchIns) {
    const amount = a.shares.get(p) ?? 0;
    stmts.push(
      amount > 0
        ? db.prepare('INSERT INTO pitch_in_shares (pitch_in_id, helper_id, amount) VALUES (?1, ?2, ?3) ON CONFLICT (pitch_in_id, helper_id) DO UPDATE SET amount = excluded.amount').bind(p, helperId, amount)
        : db.prepare('DELETE FROM pitch_in_shares WHERE pitch_in_id = ?1 AND helper_id = ?2').bind(p, helperId),
    );
  }
  if (a.offer) {
    stmts.push(
      db.prepare('INSERT INTO needs (id, move_id, label, note, taken_by, offered, position) VALUES (?1, ?2, ?3, NULL, ?4, 1, (SELECT COUNT(*) FROM needs WHERE move_id = ?2))')
        .bind(newId('nd_'), move.id, a.offer, helperId),
    );
  }
  await db.batch(stmts);
  return { helperId, dropped };
}

/** Drop an offer a Helper made. */
export async function withdrawOffer(db: D1Database, moveId: string, helperId: string, needId: string) {
  await db.prepare('DELETE FROM needs WHERE id = ?1 AND move_id = ?2 AND taken_by = ?3 AND offered = 1').bind(needId, moveId, helperId).run();
}

// ---------------------------------------------------------------------------- Lifecycle

/**
 * Delete everything MoveLink holds of a Person the Hub removed (swavely-lol ADR-0003):
 * they come off every Move they organize, a Move left with no Organizer goes entirely,
 * and every sign-up of theirs goes, freeing their Needs. Safe to run twice.
 */
export async function purgePerson(db: D1Database, personId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM move_organizers WHERE person_id = ?1').bind(personId),
    ...moveDeletes(db, 'NOT EXISTS (SELECT 1 FROM move_organizers o WHERE o.move_id = moves.id)'),
    ...helperDeletes(db, 'person_id = ?1', personId),
  ]);
}

/** Forget every Move 30 days past its last Shift (ADR-0001). Returns how many went. */
export async function forgetOldMoves(db: D1Database, at = now()): Promise<number> {
  const cutoff = at - 30 * 86_400;
  const where = 'COALESCE((SELECT MAX(ends_at) FROM shifts s WHERE s.move_id = moves.id), moves.created_at) <= ?1';
  const { results } = await db.prepare(`SELECT id FROM moves WHERE ${where}`).bind(cutoff).all<{ id: string }>();
  // By id, not by the rule: deleting a Move's Shifts first would change what the rule says.
  for (let i = 0; i < results.length; i += 50) {
    const ids = results.slice(i, i + 50).map((r) => r.id);
    await db.batch(moveDeletes(db, `id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`, ...ids));
  }
  return results.length;
}

/** Record that a scheduled email went; false if it had already. */
export async function markSent(db: D1Database, key: string, moveId: string): Promise<boolean> {
  const r = await db.prepare('INSERT OR IGNORE INTO sent_notices (key, move_id, sent_at) VALUES (?1, ?2, ?3)').bind(key, moveId, now()).run();
  return (r.meta.changes ?? 0) > 0;
}

/** The Moves with a Shift whose evening-before email is due. */
export async function movesWithRemindersDue(db: D1Database, at = now()): Promise<Move[]> {
  const { results } = await db
    .prepare(`${MOVE} WHERE m.id IN (SELECT move_id FROM shifts WHERE remind_at <= ?1 AND starts_at > ?1)`)
    .bind(at)
    .all<MoveRow>();
  return results.map(toMove);
}
