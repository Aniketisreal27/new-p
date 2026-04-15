import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ NEVER put your API key here. Use a .env file locally.
// For local dev: create a .env file with ANTHROPIC_API_KEY=sk-ant-...
// The Vite dev server proxies /api/claude → Anthropic using the env var.
// In production (Vercel), api/claude.js edge function handles this server-side.

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: () => '/v1/messages',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Pulling the key safely from the environment
            const key = process.env.ANTHROPIC_API_KEY
            
            if (!key) {
              console.error('⚠️ ANTHROPIC_API_KEY not set. Create a .env file.')
              return
            }
            proxyReq.setHeader('x-api-key', key)
            proxyReq.setHeader('anthropic-version', '2023-06-01')
            proxyReq.setHeader('anthropic-dangerous-direct-browser-access', 'true')
          })
        }
      }
    }
  }
})
