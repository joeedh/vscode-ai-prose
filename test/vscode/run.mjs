// Runs the extension tests on a temp user-data directory and a free debugging
// port, then removes the directory even when the run fails.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PREFIX = 'aiprose-vscode-';
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function sweep() {
	const names = await fs.readdir(tmpdir()).catch(() => []);
	for (const name of names.filter((n) => n.startsWith(PREFIX))) {
		await fs.rm(join(tmpdir(), name), RM_OPTIONS).catch(() => undefined);
	}
}

await sweep();
const userDataDir = mkdtempSync(join(tmpdir(), PREFIX));
let status = 1;
try {
	// The package exports only its index, which sits beside the bin
	const bin = join(dirname(createRequire(import.meta.url).resolve('@vscode/test-cli')), 'bin.mjs');
	const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
		stdio: 'inherit',
		env: { ...process.env, AIPROSE_TEST_USER_DATA: userDataDir, AIPROSE_TEST_CDP_PORT: String(await freePort()) },
	});
	status = result.status ?? 1;
} finally {
	await fs.rm(userDataDir, RM_OPTIONS);
}
process.exit(status);
