import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for the TypeScript apps (api, web, mobile).
 *
 * The public site keeps its own `apps/site/eslint.config.js` — it is plain JSX
 * and uses react/unused-imports plugins that the TS apps do not need.
 *
 * Rules that the codebase does not satisfy yet are set to `warn`, so `--quiet`
 * keeps them out of CI output while still surfacing them locally.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.expo/**",
      "**/coverage/**",
      "apps/site/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript already resolves identifiers; the base rule only reports noise
  // for DOM/Node globals.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "no-undef": "off" },
  },

  {
    files: ["apps/api/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Hooks rules for the two React apps; `exhaustive-deps` only warns so an
  // existing dependency gap cannot block a pull request.
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/mobile/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Plain JS next to the TS sources (configs, scripts) is still Node code.
  {
    files: ["apps/{api,web,mobile}/**/*.{js,cjs,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Untrusted JSON is narrowed at the boundary (`unknown` + a cast to the
      // shape actually read), so an explicit `any` is never needed.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        // Rest siblings are the idiom for "drop these keys before spreading";
        // they are deliberate, not dead code.
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-namespace": "off",
      // `catch {}` is used on purpose where a failure must not propagate.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
