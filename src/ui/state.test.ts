import { describe, expect, it } from "vitest";
import { formatUsage, initialState, rangeLabel, reduce, relativePath, type State } from "./state";

describe("reduce", () => {
	it("streams deltas and activity into one assistant entry", () => {
		let s = reduce(initialState, { type: "host", msg: { type: "turnStarted" } });
		s = reduce(s, { type: "host", msg: { type: "activity", label: "Read the block" } });
		s = reduce(s, { type: "host", msg: { type: "messageDelta", text: "Hel" } });
		s = reduce(s, { type: "host", msg: { type: "messageDelta", text: "lo" } });
		expect(s.running).toBe(true);
		expect(s.entries).toEqual([{ kind: "assistant", text: "Hello", activity: ["Read the block"] }]);
	});

	it("opens a new assistant entry after an edit", () => {
		let s = reduce(initialState, { type: "host", msg: { type: "turnStarted" } });
		s = reduce(s, { type: "host", msg: { type: "messageDelta", text: "a" } });
		s = reduce(s, { type: "host", msg: { type: "editProposed", proposal: proposal() } });
		s = reduce(s, { type: "host", msg: { type: "messageDelta", text: "b" } });
		expect(s.entries.map((e) => e.kind)).toEqual(["assistant", "edit", "assistant"]);
	});

	it("takes the current thread's title from the thread list", () => {
		const header = { id: "t1", title: "New thread", createdAt: "", updatedAt: "", filePath: "a.ts", mode: "strict" as const, model: "m" };
		let s: State = { ...initialState, thread: header };
		s = reduce(s, { type: "host", msg: { type: "threads", current: [{ ...header, title: "Tighten this" }], other: [] } });
		expect(s.thread?.title).toBe("Tighten this");
		s = reduce(s, { type: "host", msg: { type: "threads", current: [], other: [] } });
		expect(s.thread?.title).toBe("Tighten this");
	});

	it("attaches a resolution to its proposal", () => {
		let s = reduce(initialState, { type: "host", msg: { type: "editProposed", proposal: proposal() } });
		s = reduce(s, {
			type: "host",
			msg: { type: "editResolved", resolution: { id: "e1", status: "accepted", range: { start: 1, end: 2 }, text: "x" } },
		});
		const entry = s.entries[0];
		expect(entry.kind === "edit" && entry.resolution?.status).toBe("accepted");
	});
});

describe("formatting", () => {
	it("labels ranges one-based", () => {
		expect(rangeLabel({ start: 37, end: 40 })).toBe("lines 38–40");
		expect(rangeLabel({ start: 4, end: 5 })).toBe("line 5");
	});

	it("formats the usage line", () => {
		expect(
			formatUsage({ turns: 2, promptTokens: 2800, completionTokens: 300, cachedTokens: 2184, cost: 0.004 }),
		).toBe("2 turns · 3.1k tokens · 78% from cache · $0.004");
	});

	it("writes PROSE.md relative to the file", () => {
		expect(relativePath("C:/repo/src/a.ts", "C:/repo/PROSE.md")).toBe("../PROSE.md");
		expect(relativePath("/repo/src/a.ts", "/repo/src/PROSE.md")).toBe("PROSE.md");
		expect(relativePath("C:\\repo\\src\\deep\\a.ts", "C:\\repo\\PROSE.md")).toBe("../../PROSE.md");
	});
});

function proposal() {
	return {
		id: "e1",
		range: { start: 1, end: 2 },
		firstLine: 0,
		contextBefore: ["a"],
		oldLines: ["b"],
		newLines: ["c"],
		contextAfter: ["d"],
		text: "c",
	};
}
