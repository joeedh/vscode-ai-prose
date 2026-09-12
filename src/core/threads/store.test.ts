import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groupByFile, ThreadStore, type Thread } from "./store.js";

function sampleThread(store: ThreadStore, overrides: Partial<Thread> = {}): Thread {
	return store.create({
		title: "Make this plainer",
		filePath: "/w/a.ts",
		languageId: "typescript",
		mode: "strict",
		model: "z-ai/glm-5.3-flash",
		systemPrompt: "sys\n\n## Style guide\n...",
		userPrompt: "sys",
		unit: { range: { start: 3, end: 5 }, kind: "lineRun", label: "one // run", original: "// a\n// b", text: "a\nb", width: 80 },
		messages: [{ role: "user", content: "Make this plainer" }],
		usage: { turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 },
		edits: [],
		...overrides,
	});
}

describe("ThreadStore", () => {
	let home: string;
	let store: ThreadStore;

	beforeEach(async () => {
		home = await fs.mkdtemp(path.join(os.tmpdir(), "aiprose-store-"));
		store = new ThreadStore(home);
	});

	afterEach(async () => {
		await fs.rm(home, { recursive: true, force: true });
	});

	it("writes under ~/.aiprose/transcripts and loads back the same thread", async () => {
		const thread = sampleThread(store);
		await store.save(thread);
		expect(store.fileFor(thread.id)).toBe(path.join(home, ".aiprose", "transcripts", `${thread.id}.json`));
		const loaded = await store.load(thread.id);
		expect(loaded).toEqual(thread);
	});

	it("lists headers newest first from the first line only", async () => {
		const first = sampleThread(store, { title: "first" });
		await store.save(first);
		const second = sampleThread(store, { title: "second", filePath: "/w/b.md" });
		second.id = first.id.replace(/-[a-z0-9]+$/, "-zzzz");
		await store.save(second);
		const list = await store.list();
		expect(list.map((h) => h.title)).toEqual(["second", "first"]);
		expect(Object.keys(list[0]).sort()).toEqual(["createdAt", "filePath", "id", "mode", "model", "title", "updatedAt"]);
		expect(groupByFile(list, "/w/a.ts")).toEqual({ current: [list[1]], other: [list[0]] });
	});

	it("ids sort in creation order", () => {
		const a = ThreadStore.newId(new Date("2026-09-12T08:00:00Z"));
		const b = ThreadStore.newId(new Date("2026-09-12T08:00:01Z"));
		expect(a < b).toBe(true);
		expect(a).toMatch(/^20260912T080000-[a-z0-9]{4}$/);
	});

	it("titles are the first user message trimmed to 60 characters", () => {
		const long = "word ".repeat(30);
		expect(ThreadStore.titleFor(long)).toHaveLength(59);
		expect(ThreadStore.titleFor("  two\n lines  ")).toBe("two lines");
	});

	it("returns an empty list when the directory does not exist", async () => {
		expect(await store.list()).toEqual([]);
	});
});
