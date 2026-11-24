import path from "node:path";
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // The site calls the API on its own origin, so in dev that origin is Vite
    // and the request has to be forwarded to the local API.
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
