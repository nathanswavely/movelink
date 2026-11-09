-- MoveLink (CONTEXT.md): Moves, their Places, Shifts, Needs and Pitch-ins, and the
-- Helpers who sign up from a Move link. People are the Hub's, referred to by id only.
-- Every Move, and everything on it, is deleted 30 days after its last Shift (ADR-0001).

-- A Move. `link` is its Move link's token: unguessable, shown to its Organizers, and
-- replaced when it has gone somewhere it should not (the old one goes to replaced_links).
-- Times on its Shifts are wall-clock in `tz`, the Organizer's zone when they started it.
CREATE TABLE IF NOT EXISTS moves (
  id          TEXT PRIMARY KEY,              -- 'mv_' + random
  title       TEXT NOT NULL,
  notes       TEXT,
  tz          TEXT NOT NULL,                 -- IANA, 'America/New_York'
  link        TEXT NOT NULL UNIQUE,          -- the Move link's token
  created_by  TEXT NOT NULL,                 -- a Person id
  created_at  INTEGER NOT NULL               -- unix seconds
);

-- A Move link that was replaced: it now only says so.
CREATE TABLE IF NOT EXISTS replaced_links (
  link        TEXT PRIMARY KEY,
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  replaced_at INTEGER NOT NULL
);

-- Who runs a Move. All equal; a Move always has at least one.
CREATE TABLE IF NOT EXISTS move_organizers (
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (move_id, person_id)
);
CREATE INDEX IF NOT EXISTS move_organizers_person ON move_organizers (person_id);

-- Somewhere a Move happens.
CREATE TABLE IF NOT EXISTS places (
  id          TEXT PRIMARY KEY,              -- 'pl_' + random
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,                 -- 'old house'
  address     TEXT NOT NULL,
  note        TEXT,                          -- parking, door codes, stairs
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS places_move ON places (move_id);

-- A block of time at one Place. `starts`/`ends` are wall-clock in the Move's tz
-- ('2026-11-14T09:00'); the *_at columns are the same instants in unix seconds, worked
-- out on every write, and `remind_at` is 18:00 the evening before. `wanted` is a goal,
-- not a cap.
CREATE TABLE IF NOT EXISTS shifts (
  id          TEXT PRIMARY KEY,              -- 'sh_' + random
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL REFERENCES places (id),
  job         TEXT NOT NULL,                 -- 'Load the truck'
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  remind_at   INTEGER NOT NULL,
  wanted      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS shifts_move ON shifts (move_id);
CREATE INDEX IF NOT EXISTS shifts_remind ON shifts (remind_at);

-- Someone who signed up from the Move link: one row per Move. A name, a phone only the
-- Organizers see, and how to know them again: `person_id` when they are a Person, and
-- `browser` (sha256 of the ml_helper cookie) when they signed up without signing in.
CREATE TABLE IF NOT EXISTS helpers (
  id          TEXT PRIMARY KEY,              -- 'hp_' + random
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,
  person_id   TEXT,
  browser     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS helpers_move ON helpers (move_id);
CREATE INDEX IF NOT EXISTS helpers_person ON helpers (person_id);
CREATE INDEX IF NOT EXISTS helpers_browser ON helpers (browser);
CREATE UNIQUE INDEX IF NOT EXISTS helpers_move_person ON helpers (move_id, person_id) WHERE person_id IS NOT NULL;

-- Which Shifts a Helper said yes to.
CREATE TABLE IF NOT EXISTS shift_signups (
  shift_id    TEXT NOT NULL REFERENCES shifts (id) ON DELETE CASCADE,
  helper_id   TEXT NOT NULL REFERENCES helpers (id) ON DELETE CASCADE,
  signed_at   INTEGER NOT NULL,
  PRIMARY KEY (shift_id, helper_id)
);
CREATE INDEX IF NOT EXISTS shift_signups_helper ON shift_signups (helper_id);

-- Something one Helper covers. `offered` when a Helper put it there themselves.
CREATE TABLE IF NOT EXISTS needs (
  id          TEXT PRIMARY KEY,              -- 'nd_' + random
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  note        TEXT,
  taken_by    TEXT REFERENCES helpers (id) ON DELETE SET NULL,
  offered     INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS needs_move ON needs (move_id);

-- Something many Helpers add to, towards an optional rough goal.
CREATE TABLE IF NOT EXISTS pitch_ins (
  id          TEXT PRIMARY KEY,              -- 'pi_' + random
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,                 -- 'Boxes'
  goal        INTEGER,                       -- about how many, or NULL
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pitch_ins_move ON pitch_ins (move_id);

CREATE TABLE IF NOT EXISTS pitch_in_shares (
  pitch_in_id TEXT NOT NULL REFERENCES pitch_ins (id) ON DELETE CASCADE,
  helper_id   TEXT NOT NULL REFERENCES helpers (id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  PRIMARY KEY (pitch_in_id, helper_id)
);

-- Which scheduled emails have gone, so the hourly cron sends each once:
-- 'helper:<helper id>:<date>' and 'organizers:<move id>:<date>'.
CREATE TABLE IF NOT EXISTS sent_notices (
  key         TEXT PRIMARY KEY,
  move_id     TEXT NOT NULL REFERENCES moves (id) ON DELETE CASCADE,
  sent_at     INTEGER NOT NULL
);
