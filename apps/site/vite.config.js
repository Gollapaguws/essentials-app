import path from "node:path";
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Publish the bases this bundle was built against into the served HTML.
 *
 * The uptime watcher cannot see a JavaScript bundle's contents, so without this
 * it can only tell that the site loads — not that the site is talking to our API
 * and our Supabase. That blind spot is what let a stale host sit in the build:
 * the old domain answered 200 with a different application, so every
 * reachability check passed while sign-in was broken.
 *
 * `/api` is relative on purpose (the page's own origin), so the watcher resolves
 * it the way the browser does. Keep these in step with src/lib/apiBase.js.
 */
const publishBases = (env) => ({
  name: "sonus-publish-bases",
  transformIndexHtml: (html) => {
    const tags = [
      `<meta name="sonus-api-base" content="${env.VITE_API_URL || "/api"}" />`,
      env.VITE_SUPABASE_URL ? `<meta name="sonus-supabase-url" content="${env.VITE_SUPABASE_URL}" />` : "",
    ].filter(Boolean);
    return html.replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  return {
    plugins: [react(), publishBases(env)],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      // The site calls the API on its own origin, so in dev that origin is Vite
      // and the request has to be forwarded to the local API.
      proxy: { "/api": "http://127.0.0.1:4000" },
    },
  };
});
