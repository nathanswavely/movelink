import server from '@astrojs/cloudflare/entrypoints/server';
import { runRemovals } from '@swavely-lol/kit/removals';
import { forgetOldMoves, purgePerson } from './lib/data';
import { sendReminders } from './lib/notices';

/**
 * MoveLink's Worker: the Astro app for every request under swavely.lol/move, and an
 * hourly cron (wrangler.jsonc) that, each part safe to run twice,
 *
 * 1. removes whoever the Hub has removed (swavely-lol ADR-0003; the Hub cannot call a
 *    Tool, so the Tool asks it),
 * 2. forgets every Move 30 days after its last Shift (ADR-0001), and
 * 3. sends the evening-before emails that are due.
 */
export default {
  fetch: server.fetch,
  async scheduled(_controller: ScheduledController, env: ToolEnv) {
    const { removed } = await runRemovals(env, purgePerson);
    const forgotten = await forgetOldMoves(env.DB);
    const reminded = await sendReminders(env);
    console.log(`cron: ${removed} removed, ${forgotten} moves forgotten, ${reminded} emails`);
  },
};
