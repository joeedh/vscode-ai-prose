import { defineConfig } from "vitest/config";

// Runs only the live OpenRouter smoke test, which `pnpm test` never includes.
export default defineConfig({
	test: {
		include: ["src/**/live.test.ts"],
		testTimeout: 60_000,
	},
});
