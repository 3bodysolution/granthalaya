import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Pages are built ahead of time (fast and free). Only the small /api routes
// used by the Add screen run on Vercel as functions.
// When you connect a custom domain, change `site` to it.
export default defineConfig({
  site: 'https://granthalaya-sarthak.vercel.app',
  output: 'static',
  adapter: vercel({ maxDuration: 30 }), // saving can take a few seconds while it fetches film facts
  trailingSlash: 'ignore',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
});
