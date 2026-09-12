import { _electron, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { startFakeOpenRouter, type FakeOpenRouter } from "../../src/test/fake-openrouter.js";

export const TEMP_PREFIX = "aiprose-test-";
const ROOT = path.resolve(__dirname, "..", "..");
const MAIN = path.join(ROOT, "dist", "electron", "main.js");
const SAMPLE = path.join(__dirname, "fixtures", "sample.ts");
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

export interface Shell {
	app: ElectronApplication;
	page: Page;
	server: FakeOpenRouter;
	/** The Chromium profile, which also holds the copied sample file and the transcripts. */
	profileDir: string;
	cdpPort: number;
	/** A fresh copy of the sample file, so a test's edit never touches the repo. */
	file: string;
	transcriptsDir: string;
}

export async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

export const test = base.extend<{ shell: Shell }>({
	shell: async ({}, use) => {
		const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
		let app: ElectronApplication | undefined;
		let server: FakeOpenRouter | undefined;
		try {
			server = await startFakeOpenRouter();
			const cdpPort = await freePort();
			const file = path.join(profileDir, "work", "sample.ts");
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.copyFile(SAMPLE, file);
			await fs.writeFile(path.join(profileDir, "secrets.json"), JSON.stringify({ openrouterApiKey: "test-key" }));
			app = await _electron.launch({
				args: [MAIN, file],
				cwd: ROOT,
				env: {
					...process.env,
					AIPROSE_PROFILE_DIR: profileDir,
					AIPROSE_CDP_PORT: String(cdpPort),
					AIPROSE_BASE_URL: server.url,
					AIPROSE_HOME: profileDir,
				},
			});
			const page = await app.firstWindow();
			await page.waitForSelector(".file-body .ln");
			await use({ app, page, server, profileDir, cdpPort, file, transcriptsDir: path.join(profileDir, ".aiprose", "transcripts") });
		} finally {
			// Chromium keeps handles on the profile briefly after the window closes, so the removal retries
			if (app) {
				const exited = new Promise<void>((resolve) => app!.process().once("exit", () => resolve()));
				await app.close().catch(() => undefined);
				await exited;
			}
			await server?.close();
			await fs.rm(profileDir, RM_OPTIONS);
		}
	},
});

export { expect } from "@playwright/test";
