import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// test/vscode/run.mjs sets both and removes the directory afterwards; a bare
// `vscode-test` run gets a fresh directory that stays behind
const userDataDir = process.env.AIPROSE_TEST_USER_DATA ?? mkdtempSync(join(tmpdir(), 'aiprose-vscode-'));
const cdpPort = process.env.AIPROSE_TEST_CDP_PORT ?? '9338';

export default defineConfig({
	files: 'out/test/vscode/**/*.test.js',
	launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${cdpPort}`],
	env: { AIPROSE_TEST_CDP_PORT: cdpPort, AIPROSE_HOME: userDataDir },
});
