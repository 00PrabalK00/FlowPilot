import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // bind 0.0.0.0 so 127.0.0.1 + LAN reach it (Node-RED iframe uses the editor host)
    port: 5173,
    strictPort: true,  // fail loudly instead of silently moving to 5174
    proxy: {
      // SSE + REST -> backend control plane
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  }
});
