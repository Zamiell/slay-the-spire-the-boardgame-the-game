import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { checkedBuildOutput } from './scripts/lib/verification-output.mjs'

const localServer = {
  // Let the room server answer the Pages origin's preflight through the proxy.
  cors: false,
  // The room server is a separate process; the proxy keeps local development on one origin.
  proxy: {
    '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    '/ws': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: true },
  },
}

export default defineConfig(({ mode }) => {
  const singlePlayer = (process.env.VITE_SINGLE_PLAYER ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_SINGLE_PLAYER) === 'true'
  const hostedSession = (process.env.VITE_HOSTED_SESSION ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_HOSTED_SESSION) === 'true'
  return {
    ...(process.env.STS_VERIFY_BUILD_DIR ? {
      build: { outDir: checkedBuildOutput(process.cwd(), process.env.STS_VERIFY_BUILD_DIR), emptyOutDir: true },
    } : {}),
    base: singlePlayer || hostedSession ? './' : '/',
    plugins: [react()],
    // Lazy game screens must not trigger a dependency-discovery reload mid-interaction.
    optimizeDeps: { include: ['@floating-ui/react', 'motion/react', 'valibot'] },
    server: localServer,
    preview: localServer,
  }
})
