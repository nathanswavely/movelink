import { toolGuard } from '@swavely-lol/kit/guard';
import { u } from '@swavely-lol/kit/env';

/**
 * Who is this: the Hub says (swavely-lol ADR-0001), through the kit's guard. Everything
 * an Organizer does needs a Person. A **Move link** (`/move/l/<token>`) does not: whoever
 * holds it may sign up without signing in, and a Person who happens to be signed in signs
 * up as themselves. Every POST must come from this origin, and every response is noindex.
 */
export const onRequest = toolGuard({ needsPerson: (pathname) => !pathname.startsWith(u('/l/')) });
