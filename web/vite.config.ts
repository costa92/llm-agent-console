import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Tailwind v4: the Vite plugin replaces the v3 PostCSS config entirely.
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Mirror the prod nginx single-origin routing: proxy /api/* to the local Go BFF.
      // Do NOT add a rewrite — the BFF expects the /api prefix intact.
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
})
