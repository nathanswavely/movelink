# MoveLink

Round up friends to help someone move, at `swavely.lol/move`. The person running the
move shares one link in the group text; whoever opens it can sign up for a shift, take
something the move needs (a truck, pizza) or pitch in some boxes, without an account.

A Tool of the [swavely.lol hub](https://github.com/nathanswavely/swavely-lol), which signs
people in and sends the email, built on
[swavely-lol-kit](https://github.com/nathanswavely/swavely-lol-kit). Start with
[CONTEXT.md](CONTEXT.md) for the words.

## What it does

- **Moves, Places and Shifts.** A Move happens at one or more Places (old house, storage,
  new apartment); each Shift is a block of time at one of them, asking for a number of
  people. The number is a goal, not a cap.
- **Needs and Pitch-ins.** A Need is something one person covers; two trucks are two
  Needs. A Pitch-in is something everyone can bring some of, towards a rough goal.
  Helpers can offer things nobody listed.
- **One link, no accounts.** Anyone with the Move link sees all of it except phone
  numbers, which only the Organizers see. A browser that signed up is remembered by a
  cookie. Someone already on swavely.lol signs up as themselves, and a Helper may make an
  account from the link while the move is still to come
  ([swavely-lol ADR-0005](https://github.com/nathanswavely/swavely-lol/blob/main/docs/adr/0005-a-person-may-join-through-a-tool-s-link.md)).
  A link that got out can be replaced.
- **Organizers are equal.** Any Person can start a Move and add others to run it.
- **Email, through the Hub, only to People:** the evening before, a reminder to each
  Helper on a Shift and a summary to the Organizers; a cancellation within 48 hours to the
  Organizers; a moved Shift to its Helpers.
- **Forgotten.** Thirty days after a Move's last Shift, the hourly cron deletes it and
  everyone on it ([ADR-0001](docs/adr/0001-a-move-is-forgotten-30-days-after-it-ends.md)).
  It also removes whoever the Hub has removed.

## Running it

```
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local && npm run db:seed:local
npm run dev                      # http://localhost:4333/move
```

Run the Hub beside it (`npm run dev` in `../swavely-lol`, on 4331) and sign in there as
`homer@example.com`. The seed's Move link is `/move/l/springfield-seed-link-0001`.

`npm test` checks the time rules (daylight saving, reminders, the forget date).
`npm run test:flow` runs the Hub and MoveLink side by side and walks a whole Move through
sign-ups, joining, emails, a new link, a removal and being forgotten; point it at a Hub
checkout other than `../swavely-lol` with `HUB_DIR`.

## Deploying

1. The D1 database `movelink` exists (2026-11-09); its id is in `wrangler.jsonc`.
2. The Hub deployed first, with MoveLink's tile no longer marked `soon`.
3. `@swavely-lol/kit` at its tag, not from disk (it is, from v0.1.0).
4. `npm run deploy`. No secrets: mail goes through the Hub.
