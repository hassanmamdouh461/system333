import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Standalone build for the public customer menu.
 *
 * The default build produces the desktop/Electron bundle, which doubles as the admin app.
 * Publishing that to menu.engaz.tech shipped every internal screen to the public, so the menu
 * gets its own entry point and its own output directory. `wrangler-menu-site.toml` deploys
 * `dist-menu`, and `dist` is never published as a website.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-menu',
    emptyOutDir: true,
    rollupOptions: {
      input: { menu: resolve(process.cwd(), 'public-menu.html') },
    },
  },
});
