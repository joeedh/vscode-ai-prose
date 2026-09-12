const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').Plugin} */
const problemMatcher = {
	name: "esbuild-problem-matcher",
	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started");
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log("[watch] build finished");
		});
	},
};

const shared = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: "silent",
	plugins: [problemMatcher],
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
	{
		...shared,
		entryPoints: ["src/vscode/extension.ts"],
		format: "cjs",
		platform: "node",
		outfile: "dist/extension.js",
		external: ["vscode"],
	},
	{
		...shared,
		entryPoints: ["src/electron/main.ts", "src/electron/preload.ts"],
		format: "cjs",
		platform: "node",
		outdir: "dist/electron",
		external: ["electron"],
	},
	{
		...shared,
		entryPoints: { ui: "src/ui/main.tsx", shell: "src/ui/shell-main.tsx" },
		format: "esm",
		platform: "browser",
		outdir: "dist",
		jsx: "automatic",
		jsxImportSource: "preact",
		// Font urls stay relative so dist/ui.css reaches media/fonts under either host
		external: ["*.woff2"],
	},
];

async function main() {
	const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
	if (watch) {
		await Promise.all(contexts.map((ctx) => ctx.watch()));
		return;
	}
	const results = await Promise.all(contexts.map((ctx) => ctx.rebuild()));
	await Promise.all(contexts.map((ctx) => ctx.dispose()));
	if (results.some((r) => r.errors.length > 0)) {
		process.exit(1);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
