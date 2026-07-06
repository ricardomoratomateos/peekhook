import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      watch: { usePolling: true },
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/mcp': { target: apiTarget, changeOrigin: true, ws: false },
      },
    },
  }
})
