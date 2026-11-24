import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Only the hooks are unit-tested here. Pages are covered by the browser flows in
 * scripts/e2e-flows.mjs; a component test that mocks the API would mostly assert
 * markup, which those flows already prove end to end.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
