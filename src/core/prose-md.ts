import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ProseMdInfo } from "./protocol.js";

/** Finds the nearest PROSE.md at or above `fromDir`, matching the name case-insensitively. */
export async function findProseMd(fromDir: string): Promise<ProseMdInfo> {
	let dir = path.resolve(fromDir);
	for (;;) {
		const found = await proseMdIn(dir);
		if (found) {
			return { path: found };
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return { searchedFrom: path.resolve(fromDir) };
		}
		dir = parent;
	}
}

async function proseMdIn(dir: string): Promise<string | undefined> {
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch {
		return undefined;
	}
	const name = names.find((n) => n.toLowerCase() === "prose.md");
	return name === undefined ? undefined : path.join(dir, name);
}
