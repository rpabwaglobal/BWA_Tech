import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), '')
  // Em produção exigimos a env var explicitamente (sem fallback hardcoded).
  // Em dev pode-se setar VITE_FORMULARIOS_PROXY_TARGET no .env local.
  const formulariosProxyTarget = env.VITE_FORMULARIOS_PROXY_TARGET
  if (mode === 'production' && !formulariosProxyTarget) {
    // Aviso não fatal: warning no build. Build segue sem proxy de dev.
    console.warn('[vite] VITE_FORMULARIOS_PROXY_TARGET não definido — proxy /__formularios desativado.')
  }

  return {
  build: {
    // Sem source maps em produção (evita expor lógica/path de código original).
    sourcemap: mode !== 'production',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'assets/bwa-black.png',
        'assets/bwa-white.png',
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
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: formulariosProxyTarget ? {
    proxy: {
      // Mesmo origin no dev → sem CORS ao chamar a API externa de formulários (Bearer via Django).
      '/__formularios': {
        target: formulariosProxyTarget,
        changeOrigin: true,
        secure: true,
        // WS ao portal costuma gerar ECONNABORTED no terminal (rede/firewall/fecho do cliente).
        // REST continua a funcionar; novidades em Suporte em dev → polling.
        ws: false,
        rewrite: (p) => p.replace(/^\/__formularios/, ''),
      },
    },
  } : undefined,
  }
})
