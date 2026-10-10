import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Pages are made when someone visits (each shelf is different for each visitor),
// except About, Privacy and Terms, which are built ahead of time.
// When you connect a custom domain, change `site` to it.
export default defineConfig({
  site: 'https://granthalaya-sarthak.vercel.app',
  output: 'server',
  adapter: vercel({ maxDuration: 30 }), // saving can take a few seconds while it looks a title up
  trailingSlash: 'ignore',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  security: {
    checkOrigin: true,
    // Vercel tells the site which address someone opened, but Astro only believes it for the
    // domains listed here. Without this list Astro thinks every page lives at https://localhost,
    // which breaks Google sign-in and every save. Add your custom domain here when you connect one.
    allowedDomains: [
      { protocol: 'https', hostname: 'granthalaya-sarthak.vercel.app' },
      { protocol: 'https', hostname: '*.vercel.app' }, // preview copies
    ],
  },
  vite: { plugins: [tailwindcss()] },
});
