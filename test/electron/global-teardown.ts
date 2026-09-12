import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TEMP_PREFIX } from "./shell-fixture.js";

/** Removes profiles a killed run left behind, since their fixtures never reached teardown. */
export default async function globalTeardown(): Promise<void> {
	const tmp = os.tmpdir();
	const names = await fs.readdir(tmp).catch(() => [] as string[]);
	for (const name of names.filter((n) => n.startsWith(TEMP_PREFIX))) {
		await fs.rm(path.join(tmp, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
	}
}
