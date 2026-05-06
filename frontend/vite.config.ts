import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), '')
  const formulariosProxyTarget =
    env.VITE_FORMULARIOS_PROXY_TARGET || 'https://api.bwa.global:3334'

  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'assets/bwa-black.png',
        'assets/bwa-white.png',
        'gradients/**/*.webp',
      ],
      manifest: {
        name: 'BWA Tech',
        short_name: 'BWA',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111827',
        icons: [
          { src: '/assets/bwa-black.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/bwa-black.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        // PNGs de gradients são muito grandes para precache; usamos WebP no precache
        // e deixamos PNG apenas para fallback em runtime.
        globIgnores: ['**/gradients/**/*.png'],
        runtimeCaching: [
          {
            urlPattern: /\/gradients\/.*\.(webp|png)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gradients-cache-v1',
              expiration: {
                maxEntries: 128,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Mesmo origin no dev → sem CORS ao chamar a API externa de formulários (Bearer via Django).
      '/__formularios': {
        target: formulariosProxyTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/__formularios/, ''),
      },
    },
  },
  }
})
