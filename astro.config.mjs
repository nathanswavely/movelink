// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// MoveLink lives at swavely.lol/move, beside the Hub (swavely-lol ADR-0001). Every page
// is rendered on request: who is signed in, and which Helper this browser is, are asked
// each time.
export default defineConfig({
  site: 'https://swavely.lol',
  base: '/move',
  trailingSlash: 'ignore',
  output: 'server',
  session: false,
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
});
