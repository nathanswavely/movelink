/**
 * MoveLink end to end, against the Hub (`npm run test:flow`): an Organizer sets up a
 * Move, Helpers sign up from its link with and without accounts, one Joins, a Need is
 * never taken twice, the evening-before emails go once, the link is replaced, a Removal
 * reaches here, and a Move is forgotten 30 days after its last Shift (ADR-0001).
 *
 * Builds the Hub and this Tool, then runs both with `wrangler dev` on their own ports,
 * their own state under .wrangler/test-flow and their own dev registry, so a dev server
 * already running for either is never touched. The Hub is ../swavely-lol, or HUB_DIR.
 * Signs in by writing session rows straight into the Hub's state. Exits non-zero on the
 * first broken promise, and always stops what it started.
 */
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = resolve(TOOL, process.env.HUB_DIR ?? '../swavely-lol');
// Short on purpose: workerd's SQLite fails on Windows under a long path.
const STATE = resolve(TOOL, '.wrangler/tf');
const stateOf = (cwd) => resolve(STATE, cwd === HUB ? 'hub' : 'tool');
const REGISTRY = resolve(TOOL, '.wrangler/tf-registry');
const HUB_PORT = Number(process.env.HUB_PORT ?? 4371);
const TOOL_PORT = Number(process.env.TOOL_PORT ?? 4373);
const hubAt = `http://127.0.0.1:${HUB_PORT}`;
const toolAt = `http://127.0.0.1:${TOOL_PORT}/move`;
const env = { ...process.env, WRANGLER_REGISTRY_PATH: REGISTRY, NO_COLOR: '1' };

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error('FAIL', what); } else console.log('ok  ', what); };

function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args.slice(1).join(' ')} in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const wrangler = (cwd, ...args) => run(cwd, [resolve(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args]);
const sqlFile = (cwd, db, file) => wrangler(cwd, 'd1', 'execute', db, '--local', '--persist-to', stateOf(cwd), '--file', file);
function sql(cwd, db, command) {
  const out = JSON.parse(wrangler(cwd, 'd1', 'execute', db, '--local', '--persist-to', stateOf(cwd), '--json', '--command', command));
  return out[out.length - 1].results;
}
const hubSql = (q) => sql(HUB, 'swavely-lol', q);
const toolSql = (q) => sql(TOOL, 'movelink', q);

// ------------------------------------------------------------- servers ----

const servers = [];
function start(cwd, port, extra = []) {
  const child = spawn(
    process.execPath,
    [resolve(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '-c', 'dist/server/wrangler.json', '--persist-to', stateOf(cwd), '--port', String(port), '--inspector-port', String(port + 5000), '--show-interactive-dev-session=false', ...extra],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
  );
  const s = { child, log: '' };
  child.stdout.on('data', (d) => (s.log += d));
  child.stderr.on('data', (d) => (s.log += d));
  servers.push(s);
  return s;
}
function stopAll() {
  for (const { child } of servers) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
}
/** One request on a connection of its own (workerd closes idle keep-alive ones). */
function http(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = request(url, { method, headers, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => done({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, location: res.headers.location ?? '', setCookie: [res.headers['set-cookie'] ?? []].flat(), text }));
    });
    req.on('error', fail);
    req.end(body);
  });
}
async function up(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await http(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never came up`);
}
async function free(port) {
  try { await http(`http://127.0.0.1:${port}/`); return false; } catch { return true; }
}

// ------------------------------------------------------------- helpers ----

/** A browser: its cookies, kept across requests. */
function browser() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r) => {
    for (const c of r.setCookie) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return r;
  };
  return {
    jar,
    signIn(personId) {
      const id = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(id).digest('hex');
      hubSql(`INSERT INTO sessions (id_hash, person_id, created_at, expires_at, last_seen_at, user_agent) VALUES ('${hash}', '${personId}', 0, 4102444800, 0, 'test-flow')`);
      jar.set('lol_session', id);
    },
    get: async (url) => keep(await http(url, { headers: { Cookie: cookie() } })),
    post: async (url, form) =>
      keep(await http(url, { method: 'POST', headers: { Cookie: cookie(), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() })),
  };
}
async function tick() {
  const r = await http(`http://127.0.0.1:${TOOL_PORT}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('23 * * * *')}`);
  check(r.ok, `the hourly cron runs (${r.status})`);
}
/** A local date in New York, `days` from now. */
function nyDate(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const rowsOf = (moveId) => {
  const [r] = toolSql(`SELECT
    (SELECT count(*) FROM moves WHERE id = '${moveId}') AS moves,
    (SELECT count(*) FROM places WHERE move_id = '${moveId}') AS places,
    (SELECT count(*) FROM shifts WHERE move_id = '${moveId}') AS shifts,
    (SELECT count(*) FROM helpers WHERE move_id = '${moveId}') AS helpers,
    (SELECT count(*) FROM needs WHERE move_id = '${moveId}') AS needs,
    (SELECT count(*) FROM pitch_ins WHERE move_id = '${moveId}') AS pitch_ins,
    (SELECT count(*) FROM move_organizers WHERE move_id = '${moveId}') AS organizers,
    (SELECT count(*) FROM shift_signups WHERE shift_id NOT IN (SELECT id FROM shifts)) AS orphan_signups,
    (SELECT count(*) FROM pitch_in_shares WHERE pitch_in_id NOT IN (SELECT id FROM pitch_ins)) AS orphan_shares`);
  return Object.entries(r).filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n}`);
};

// ---------------------------------------------------------------- the flow ----

async function main() {
  if (!(await free(HUB_PORT)) || !(await free(TOOL_PORT))) throw new Error(`port ${HUB_PORT} or ${TOOL_PORT} is in use; set HUB_PORT and TOOL_PORT`);
  console.log(`building the Hub (${HUB}) and MoveLink`);
  for (const cwd of [HUB, TOOL]) run(cwd, [resolve(cwd, 'node_modules/astro/bin/astro.mjs'), 'build']);
  rmSync(STATE, { recursive: true, force: true });
  rmSync(REGISTRY, { recursive: true, force: true });
  wrangler(HUB, 'd1', 'migrations', 'apply', 'swavely-lol', '--local', '--persist-to', stateOf(HUB));
  sqlFile(HUB, 'swavely-lol', 'scripts/dev-seed.sql');
  wrangler(TOOL, 'd1', 'migrations', 'apply', 'movelink', '--local', '--persist-to', stateOf(TOOL));

  start(HUB, HUB_PORT);
  start(TOOL, TOOL_PORT, ['--test-scheduled']);
  await up(`${hubAt}/healthz`);
  await up(`${toolAt}/healthz`);

  const homer = browser(); homer.signIn('p_homer');
  const marge = browser(); marge.signIn('p_marge');
  const lisa = browser(); lisa.signIn('p_lisa');
  const dave = browser();   // no account
  const priya = browser();  // no account
  const stranger = browser();

  // ------------------------------------------------- an Organizer sets up ----
  check((await stranger.get(`${toolAt}/`)).status === 302, 'the home page needs a Person');
  const started = await homer.post(`${toolAt}/`, { title: "Homer's move", tz: 'America/New_York' });
  const moveId = /\/move\/m\/(mv_[A-Za-z0-9_-]+)/.exec(started.location)?.[1];
  check(started.status === 303 && !!moveId, `Homer starts a Move (${started.location})`);
  const m = `${toolAt}/m/${moveId}`;
  await homer.post(m, { action: 'place', label: 'old house', address: '742 Evergreen Terrace', note: 'Driveway is free' });
  await homer.post(m, { action: 'place', label: 'new house', address: '1 Main St' });
  const [oldPlace, newPlace] = toolSql(`SELECT id FROM places WHERE move_id = '${moveId}' ORDER BY position`).map((r) => r.id);
  const soon = nyDate(1);  // within 48 hours: cancelling it is late
  await homer.post(m, { action: 'shift', job: 'Load the truck', place: oldPlace, day: soon, start: '09:00', end: '12:00', wanted: '2' });
  await homer.post(m, { action: 'shift', job: 'Unload', place: newPlace, day: nyDate(20), start: '13:00', end: '16:00', wanted: '3' });
  const bad = await homer.post(m, { action: 'shift', job: 'Backwards', place: newPlace, day: soon, start: '12:00', end: '09:00', wanted: '2' });
  check(bad.status === 200 && bad.text.includes('has to end after it starts'), 'a Shift that ends before it starts is refused');
  const [load, unload] = toolSql(`SELECT id FROM shifts WHERE move_id = '${moveId}' ORDER BY starts_at`).map((r) => r.id);
  await homer.post(m, { action: 'need', label: 'Pickup truck' });
  await homer.post(m, { action: 'pitch-in', label: 'Boxes', goal: '40' });
  const truck = toolSql(`SELECT id FROM needs WHERE move_id = '${moveId}'`)[0].id;
  const boxes = toolSql(`SELECT id FROM pitch_ins WHERE move_id = '${moveId}'`)[0].id;
  check(!!load && !!unload && !!truck && !!boxes, 'two Places, two Shifts, a Need and a Pitch-in');
  check((await lisa.get(m)).status === 404, "someone who isn't an Organizer gets a 404 for the Organizer's page");

  let token = toolSql(`SELECT link FROM moves WHERE id = '${moveId}'`)[0].link;
  const link = () => `${toolAt}/l/${token}`;
  check((await homer.get(m)).text.includes(`/move/l/${token}`), "the Organizer's page shows the Move link");

  // ------------------------------------------------- Helpers sign up ----
  const page = await stranger.get(link());
  check(page.ok && page.text.includes('742 Evergreen Terrace') && page.text.includes('Sign me up'), 'anyone with the link sees the Move, addresses included, with no sign-in');
  const daveIn = await dave.post(link(), { action: 'answer', name: 'Dave', phone: '555-0199', shift: load, need: truck, [`share:${boxes}`]: '10' });
  check(daveIn.status === 303 && dave.jar.has('ml_helper'), 'Dave signs up with a name and is remembered by a cookie');
  const daveRow = toolSql(`SELECT id, person_id, browser FROM helpers WHERE move_id = '${moveId}' AND name = 'Dave'`)[0];
  check(!!daveRow?.browser && daveRow.person_id === null, 'as a browser, not a Person');
  const publicView = (await stranger.get(link())).text;
  check(publicView.includes('Dave') && !publicView.includes('555-0199'), "anyone sees Dave is coming; nobody but the Organizers sees his phone");
  check((await homer.get(m)).text.includes('555-0199'), 'the Organizers do');
  check((await dave.get(link())).text.includes('Save my answer'), 'Dave, back on the same browser, can change his answer');

  await priya.post(link(), { action: 'answer', name: 'Priya', shift: load, need: truck, offer: 'A dolly' });
  check(toolSql(`SELECT taken_by FROM needs WHERE id = '${truck}'`)[0].taken_by === daveRow.id, 'a Need Dave took stays his when Priya ticks it too');
  check(toolSql(`SELECT count(*) AS n FROM needs WHERE move_id = '${moveId}' AND offered = 1 AND label = 'A dolly'`)[0].n === 1, "Priya's offer of a dolly is a Need she has taken");
  await lisa.post(link(), { action: 'answer', shift: load });
  const lisaRow = toolSql(`SELECT name FROM helpers WHERE move_id = '${moveId}' AND person_id = 'p_lisa'`)[0];
  check(lisaRow?.name === 'Lisa Simpson', 'Lisa, signed in, signs up as herself without typing a name');
  check((await stranger.get(link())).text.includes('+1 extra'), 'the Shift wanted two and has three: the goal is not a cap');

  // ------------------------------------------------- Dave joins ----
  const joined = await dave.post(link(), { action: 'join', email: 'dave@example.com' });
  check(joined.status === 303 && joined.location.includes('/login?') && joined.location.includes('dave%40example.com'), `joining sends Dave to the Hub's sign-in (${joined.location})`);
  const davePerson = hubSql(`SELECT id, added_by, joined_via FROM people WHERE email = 'dave@example.com'`)[0];
  check(davePerson?.added_by === 'p_homer' && davePerson.joined_via === "Homer's move on MoveLink", 'he is a Person, credited to the first Organizer, with where he came from');
  check(toolSql(`SELECT person_id FROM helpers WHERE id = '${daveRow.id}'`)[0].person_id === null, 'his answer is not his account until he signs in');
  dave.signIn(davePerson.id);
  await dave.get(link());
  check(toolSql(`SELECT person_id FROM helpers WHERE id = '${daveRow.id}'`)[0].person_id === davePerson.id, 'signed in on the same browser, his answer comes with him');
  check((await homer.get(`${hubAt}/people`)).text.includes("Joined through Homer&#39;s move on MoveLink") || (await homer.get(`${hubAt}/people`)).text.includes("Joined through Homer's move on MoveLink"), 'the People page says where he came from');

  // ------------------------------------------------- the evening before ----
  toolSql(`UPDATE shifts SET remind_at = unixepoch() - 60 WHERE id = '${load}'`);
  await tick();
  const sent = toolSql(`SELECT key FROM sent_notices WHERE move_id = '${moveId}' ORDER BY key`).map((r) => r.key);
  const lisaHelper = toolSql(`SELECT id FROM helpers WHERE person_id = 'p_lisa' AND move_id = '${moveId}'`)[0].id;
  check(sent.includes(`organizers:${moveId}:${soon}`), 'the Organizers get the evening-before summary');
  check(sent.includes(`helper:${lisaHelper}:${soon}`) && sent.includes(`helper:${daveRow.id}:${soon}`), 'each Helper with an account gets a reminder');
  check(!sent.some((k) => k.includes(toolSql(`SELECT id FROM helpers WHERE name = 'Priya'`)[0].id)), 'Priya, with no account, gets nothing');
  await tick();
  check(toolSql(`SELECT count(*) AS n FROM sent_notices WHERE move_id = '${moveId}'`)[0].n === sent.length, 'and nothing goes twice');

  // ------------------------------------------------- changing and cancelling ----
  const moved = await homer.post(m, { action: 'shift', id: unload, job: 'Unload', place: newPlace, day: nyDate(21), start: '13:00', end: '16:00', wanted: '3' });
  check(moved.status === 303, 'an Organizer moves a Shift a day later');
  await dave.post(link(), { action: 'answer', shift: unload, [`share:${boxes}`]: '10' });
  check(toolSql(`SELECT count(*) AS n FROM shift_signups WHERE shift_id = '${load}' AND helper_id = '${daveRow.id}'`)[0].n === 0, 'Dave drops the morning Shift (late: the Organizers are told)');
  check(toolSql(`SELECT taken_by FROM needs WHERE id = '${truck}'`)[0].taken_by === null, 'unticking the truck frees it');

  // ------------------------------------------------- a new link ----
  await homer.post(m, { action: 'link' });
  const old = token;
  token = toolSql(`SELECT link FROM moves WHERE id = '${moveId}'`)[0].link;
  const gone = await stranger.get(`${toolAt}/l/${old}`);
  check(token !== old && gone.status === 410 && gone.text.includes('was replaced'), 'the old link only says it was replaced');
  check((await stranger.get(link())).text.includes('Dave'), 'the new one works, and everyone who signed up is still on it');

  // ------------------------------------------------- Organizers ----
  await homer.post(m, { action: 'add-organizer', name: 'Marge Simpson', email: 'marge@example.com' });
  check((await marge.get(m)).ok, 'Homer adds Marge as an Organizer, by the address she signs in with');
  const leave = await homer.post(m, { action: 'remove-organizer', id: 'p_marge' });
  check(leave.status === 303, 'and either can remove the other');
  const last = await homer.post(m, { action: 'remove-organizer', id: 'p_homer' });
  check(/done=last-organizer/.test(last.location), 'but the last Organizer stays');

  // ------------------------------------------------- Removal (swavely-lol ADR-0003) ----
  const margeMove = /\/m\/(mv_[A-Za-z0-9_-]+)/.exec((await marge.post(`${toolAt}/`, { title: "Marge's move", tz: 'America/New_York' })).location)?.[1];
  await homer.post(`${hubAt}/people`, { action: 'remove', id: 'p_lisa' });
  await homer.post(`${hubAt}/people`, { action: 'remove', id: 'p_marge' });
  await tick();
  check(toolSql(`SELECT count(*) AS n FROM helpers WHERE person_id = 'p_lisa'`)[0].n === 0, "Lisa's sign-ups go when she is Removed");
  check(rowsOf(margeMove).length === 0, `a Move whose only Organizer was Removed goes entirely (${rowsOf(margeMove).join(', ') || 'none'})`);
  check(toolSql(`SELECT count(*) AS n FROM moves WHERE id = '${moveId}'`)[0].n === 1, "Homer's Move stays");

  // ------------------------------------------------- forgotten (ADR-0001) ----
  toolSql(`UPDATE shifts SET starts_at = unixepoch() - 31 * 86400 - 3600, ends_at = unixepoch() - 31 * 86400 WHERE move_id = '${moveId}'`);
  await tick();
  check(rowsOf(moveId).length === 0, `30 days after its last Shift the Move is forgotten, everyone on it included (${rowsOf(moveId).join(', ') || 'none'})`);
  check((await stranger.get(link())).status === 404, 'and its link goes nowhere');
}

try {
  await main();
} catch (e) {
  failures++;
  console.error(e);
  for (const s of servers) console.error(s.log.slice(-3000));
} finally {
  stopAll();
}
if (failures) {
  console.error(`flow: ${failures} broken`);
  process.exit(1);
}
console.log('flow: every promise holds');
