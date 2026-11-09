-- A made-up Move for local development (`npm run db:seed:local`), using the Hub's seed
-- People (swavely-lol/scripts/dev-seed.sql). Never real people or addresses: the repo is
-- public. Grampa is moving in summer 2099, so it never goes stale or gets forgotten.
-- Its link is /move/l/springfield-seed-link-0001.
DELETE FROM sent_notices; DELETE FROM pitch_in_shares; DELETE FROM pitch_ins; DELETE FROM needs;
DELETE FROM shift_signups; DELETE FROM helpers; DELETE FROM shifts; DELETE FROM places;
DELETE FROM move_organizers; DELETE FROM replaced_links; DELETE FROM moves;
DELETE FROM hub_cursor; -- the Hub's seed empties its list of Removed People too

INSERT INTO moves (id, title, notes, tz, link, created_by, created_at) VALUES
  ('mv_grampa', 'Grampa''s move', 'Bring gloves. Lunch is on us.', 'America/New_York', 'springfield-seed-link-0001', 'p_homer', 0);
INSERT INTO move_organizers (move_id, person_id, added_at) VALUES ('mv_grampa', 'p_homer', 0), ('mv_grampa', 'p_marge', 0);

INSERT INTO places (id, move_id, label, address, note, position) VALUES
  ('pl_old', 'mv_grampa', 'old place', '1 Retirement Castle Way, Springfield', 'Park in the visitor lot; room 4B, elevator at the back.', 0),
  ('pl_new', 'mv_grampa', 'new place', '742 Evergreen Terrace, Springfield', 'Street parking only.', 1);

-- 2099-06-13 is a Saturday. 9am EDT is 13:00Z: 4085038800. Reminders 18:00 the evening before.
INSERT INTO shifts (id, move_id, place_id, job, starts, ends, starts_at, ends_at, remind_at, wanted) VALUES
  ('sh_load', 'mv_grampa', 'pl_old', 'Load the truck', '2099-06-13T09:00', '2099-06-13T12:00', 4085038800, 4085049600, 4084984800, 4),
  ('sh_unload', 'mv_grampa', 'pl_new', 'Unload and carry in', '2099-06-13T13:00', '2099-06-13T16:00', 4085053200, 4085064000, 4084984800, 3);

INSERT INTO helpers (id, move_id, name, phone, note, person_id, browser, created_at) VALUES
  ('hp_lisa', 'mv_grampa', 'Lisa Simpson', '555-0101', NULL, 'p_lisa', NULL, 1),
  ('hp_lenny', 'mv_grampa', 'Lenny', '555-0177', 'Carl might come too', NULL, NULL, 2),
  ('hp_patty', 'mv_grampa', 'Patty Bouvier', NULL, NULL, 'p_patty', NULL, 3);
INSERT INTO shift_signups (shift_id, helper_id, signed_at) VALUES
  ('sh_load', 'hp_lisa', 1), ('sh_load', 'hp_lenny', 2), ('sh_unload', 'hp_lenny', 2), ('sh_unload', 'hp_patty', 3);

INSERT INTO needs (id, move_id, label, note, taken_by, offered, position) VALUES
  ('nd_truck', 'mv_grampa', 'Pickup truck', 'For the recliner', 'hp_lenny', 0, 0),
  ('nd_pizza', 'mv_grampa', 'Pizza for the crew', NULL, NULL, 0, 1),
  ('nd_dolly', 'mv_grampa', 'Dolly', NULL, 'hp_patty', 1, 2);
INSERT INTO pitch_ins (id, move_id, label, goal, position) VALUES
  ('pi_boxes', 'mv_grampa', 'Boxes', 40, 0),
  ('pi_tape', 'mv_grampa', 'Rolls of tape', NULL, 1);
INSERT INTO pitch_in_shares (pitch_in_id, helper_id, amount) VALUES ('pi_boxes', 'hp_lisa', 10), ('pi_boxes', 'hp_patty', 15), ('pi_tape', 'hp_lenny', 2);
