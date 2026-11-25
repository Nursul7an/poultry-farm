import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_BASE: '/poultry-farm/' when hosted on GitHub Pages (https://<user>.github.io/poultry-farm/), '/' elsewhere.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Птичник — журнал фермы',
        short_name: 'Птичник',
        description: 'Ежедневный журнал птичника и контроль фермы',
        lang: 'ru',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#EEF1F3',
        theme_color: '#0D5C7D',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
