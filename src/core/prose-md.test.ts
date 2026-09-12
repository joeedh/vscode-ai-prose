import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProseMd } from "./prose-md.js";

describe("findProseMd", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "aiprose-prosemd-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("finds a PROSE.md two directories up, case-insensitively", async () => {
		const deep = path.join(root, "a", "b");
		await fs.mkdir(deep, { recursive: true });
		await fs.writeFile(path.join(root, "prose.MD"), "# style\n");
		expect(await findProseMd(deep)).toEqual({ path: path.join(root, "prose.MD") });
	});

	it("prefers the nearest file", async () => {
		const deep = path.join(root, "a", "b");
		await fs.mkdir(deep, { recursive: true });
		await fs.writeFile(path.join(root, "PROSE.md"), "outer\n");
		await fs.writeFile(path.join(root, "a", "PROSE.md"), "inner\n");
		expect(await findProseMd(deep)).toEqual({ path: path.join(root, "a", "PROSE.md") });
	});

	it("reports the start directory when nothing is found", async () => {
		const deep = path.join(root, "x");
		await fs.mkdir(deep, { recursive: true });
		const result = await findProseMd(deep);
		expect(result).toEqual({ searchedFrom: deep });
	});
});
