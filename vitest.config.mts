import { defineConfig } from "vitest/config";

export default defineConfig({
	oxc: {
		jsx: { runtime: "automatic", importSource: "preact" },
	},
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		exclude: ["src/test/vscode/**", "**/live.test.ts", "node_modules/**"],
		passWithNoTests: true,
	},
});
