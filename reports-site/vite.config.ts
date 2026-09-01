import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The reports portal is a self-contained SPA deployed to reporting.engaz.tech.
// Base path is absolute-root so it works whether served from a subdomain root.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
