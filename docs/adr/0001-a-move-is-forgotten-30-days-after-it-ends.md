# A Move is forgotten 30 days after its last Shift

## Status

accepted (2026-11-09)

## Decision

Thirty days after a **Move's** last **Shift** ends, MoveLink deletes all of it: the Move,
its Places and their addresses, its Shifts, Needs and Pitch-ins, and every **Helper** with whatever they gave (a
name, a phone number). Nothing is kept, not even for the **Organizers**. The hourly cron
the Tool runs anyway, for the Hub's Removals, does it. The Organizer's page says when the
Move will go.

Two more ways a Move or a Helper goes sooner:

- **An Organizer Removed from the Hub** (swavely-lol ADR-0003) comes off every Move. A
  Move left with no Organizer is deleted then, since nobody can run it.
- **A Helper** cancels from the browser that signed up, or any Organizer removes them.
- **A Helper who is a Person and is Removed** from the Hub loses every sign-up; a Need
  they had taken is free again, and their share of a Pitch-in goes.

## Context

Helpers sign up from the **Move link** with no sign-in and are never People of the Hub,
so the Hub's Removal, which is what the privacy page's promise rests on, cannot reach
them. Without an end date, a friend's phone number and two home addresses would sit in
D1 for good, with nobody to ask to take them out. Their only reason to exist is one
moving day.

## Considered Options

**Keep Moves.** A record of who helped, and a Move to copy for the next one. But it keeps
strangers' details indefinitely with no Removal path. Declined; an Organizer who wants a
record can screenshot the page.

**Forget the Helpers, keep the Move.** Keeps an outline to copy without anyone's details.
The addresses would still linger, and copying a Move is cheap to type again. Declined for
now.

## Consequences

- The privacy page gains a line: MoveLink forgets a Move, and everyone who signed up for
  it, 30 days after moving day.
- The cron that reads `removedSince` also runs the expiry; both must be safe to run twice.
- An Organizer who moves a Shift later moves the date the Move is forgotten with it.
