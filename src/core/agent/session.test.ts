import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config, Host } from "../host.js";
import type { HostToUi, LineRange } from "../protocol.js";
import { ThreadStore, TITLE_MAX } from "../threads/store.js";
import { startFakeOpenRouter, type FakeOpenRouter } from "../../test/fake-openrouter.js";
import { BLOCK_CHANGED, MISSING_KEY, SECRET_KEY, Session } from "./session.js";

const SOURCE = [
	"const a = 1;",
	"// This comment needs an edit.",
	"// It spans two lines.",
	"const b = 2;",
	"const c = 3;",
].join("\n");

/** An editor made of strings, with the cursor on the comment run. */
class MemoryHost implements Host {
	text = SOURCE;
	line = 1;
	secrets = new Map<string, string>();
	settings: Config;
	clipboard = "";
	fixes: string[] = [];
	readonly filePath: string;

	constructor(readonly home: string, baseUrl: string, filePath?: string) {
		this.filePath = filePath ?? path.join(home, "src", "demo.ts");
		this.settings = { model: "z-ai/glm-5.3-flash", systemPrompt: "", baseUrl };
	}

	async document() {
		return { path: this.filePath, languageId: "typescript", text: this.text };
	}
	async cursor() {
		return { line: this.line, character: 0 };
	}
	async applyEdit(range: LineRange, text: string) {
		const lines = this.text.split("\n");
		lines.splice(range.start, range.end - range.start, ...text.split("\n"));
		this.text = lines.join("\n");
	}
	async secret(name: string) {
		return this.secrets.get(name);
	}
	async setSecret(name: string, value: string) {
		this.secrets.set(name, value);
	}
	async config() {
		return { ...this.settings };
	}
	async setConfig(patch: Partial<Config>) {
		Object.assign(this.settings, patch);
	}
	async clipboardWrite(text: string) {
		this.clipboard = text;
	}
	async openFix(kind: string) {
		this.fixes.push(kind);
	}
	homeDir() {
		return this.home;
	}
}

interface Rig {
	host: MemoryHost;
	store: ThreadStore;
	session: Session;
	messages: HostToUi[];
	/** Resolves with the next message of `type`, including one already received after `from`. */
	next<T extends HostToUi["type"]>(type: T, from?: number): Promise<Extract<HostToUi, { type: T }>>;
}

let server: FakeOpenRouter;
let home: string;

beforeEach(async () => {
	server = await startFakeOpenRouter();
	home = await fs.mkdtemp(path.join(os.tmpdir(), "aiprose-session-"));
});

afterEach(async () => {
	await server.close();
	await fs.rm(home, { recursive: true, force: true });
});

function rig(filePath?: string): Rig {
	const host = new MemoryHost(home, server.url, filePath);
	host.secrets.set(SECRET_KEY, "test-key");
	const store = new ThreadStore(home);
	const messages: HostToUi[] = [];
	const waiters: { type: string; resolve: (m: HostToUi) => void }[] = [];
	const session = new Session({
		host,
		store,
		sink: (msg) => {
			messages.push(msg);
			for (const w of waiters.splice(0)) {
				if (w.type === msg.type) {
					w.resolve(msg);
				} else {
					waiters.push(w);
				}
			}
		},
	});
	const next = <T extends HostToUi["type"]>(type: T, from = 0) =>
		new Promise<Extract<HostToUi, { type: T }>>((resolve) => {
			const seen = messages.slice(from).find((m) => m.type === type);
			if (seen) {
				resolve(seen as Extract<HostToUi, { type: T }>);
			} else {
				waiters.push({ type, resolve: (m) => resolve(m as Extract<HostToUi, { type: T }>) });
			}
		});
	return { host, store, session, messages, next };
}

const writeCall = (id: string, text: string) => ({ id, name: "write_text", arguments: JSON.stringify({ text }) });
const readCall = (id: string) => ({ id, name: "read_text", arguments: "{}" });

/** Chat requests only, since the model list is fetched in the background as well. */
function chats(server: FakeOpenRouter) {
	return server.requests.filter((r) => r.path.endsWith("/chat/completions"));
}

function systemText(server: FakeOpenRouter, requestIndex: number): string {
	return (chats(server)[requestIndex].body as { messages: { content: { text: string }[] }[] }).messages[0].content[0].text;
}

function toolResult(server: FakeOpenRouter, requestIndex: number, callId: string): unknown {
	const body = chats(server)[requestIndex].body as { messages: { role: string; tool_call_id?: string; content: string }[] };
	const msg = body.messages.find((m) => m.role === "tool" && m.tool_call_id === callId);
	return msg ? JSON.parse(msg.content) : undefined;
}

describe("Session", () => {
	it("applies an accepted write to the file and the transcript", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ toolCalls: [writeCall("c1", "This comment was edited.")] });
		server.script({ text: "Done." });
		const sending = r.session.send("Tighten this");
		const proposed = await r.next("editProposed");
		expect(proposed.proposal.range).toEqual({ start: 1, end: 3 });
		expect(proposed.proposal.oldLines).toEqual(["// This comment needs an edit.", "// It spans two lines."]);
		expect(proposed.proposal.newLines).toEqual(["// This comment was edited."]);
		expect(proposed.proposal.contextBefore).toEqual(["const a = 1;"]);
		expect(proposed.proposal.contextAfter).toEqual(["const b = 2;", "const c = 3;"]);
		await r.session.handle({ type: "acceptEdit", id: proposed.proposal.id });
		await sending;

		expect(r.host.text).toBe(["const a = 1;", "// This comment was edited.", "const b = 2;", "const c = 3;"].join("\n"));
		expect(toolResult(server, 1, "c1")).toEqual({ status: "accepted" });
		const resolved = await r.next("editResolved");
		expect(resolved.resolution.status).toBe("accepted");
		expect(resolved.resolution.range).toEqual({ start: 1, end: 2 });
		const galley = r.messages.filter((m) => m.type === "galley").at(-1) as Extract<HostToUi, { type: "galley" }>;
		expect(galley.unit).toMatchObject({ range: { start: 1, end: 2 }, text: "This comment was edited." });

		const stored = await r.store.load(r.session.thread!.id);
		expect(stored.edits).toHaveLength(1);
		expect(stored.edits[0].resolution.status).toBe("accepted");
		expect(stored.unit?.range).toEqual({ start: 1, end: 2 });
		expect(stored.usage.turns).toBe(1);
		expect(stored.usage.promptTokens).toBe(200);
		expect(r.messages.filter((m) => m.type === "activity").map((m) => (m as { label: string }).label)).toEqual(["Proposed an edit"]);
		expect(r.messages.at(-2)?.type).toBe("turnEnded");
	});

	it("leaves the file alone on reject and stores the final text", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ toolCalls: [writeCall("c1", "Rejected wording.")] });
		server.script({ text: "Understood." });
		const sending = r.session.send("Try again");
		const proposed = await r.next("editProposed");
		await r.session.handle({ type: "rejectEdit", id: proposed.proposal.id });
		await sending;

		expect(r.host.text).toBe(SOURCE);
		expect(toolResult(server, 1, "c1")).toEqual({ status: "rejected" });
		const stored = await r.store.load(r.session.thread!.id);
		expect(stored.edits[0].resolution).toMatchObject({ status: "rejected", text: "// Rejected wording.", range: { start: 1, end: 3 } });
		expect(stored.unit?.original).toBe("// This comment needs an edit.\n// It spans two lines.");
	});

	it("rejects the pending write and aborts the turn on stop", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ toolCalls: [writeCall("c1", "Never applied.")] });
		server.script({ text: "This reply must not be requested." });
		const sending = r.session.send("Edit it");
		await r.next("editProposed");
		await r.session.handle({ type: "stop" });
		await sending;

		expect(r.host.text).toBe(SOURCE);
		expect(chats(server)).toHaveLength(1);
		const resolved = await r.next("editResolved");
		expect(resolved.resolution.status).toBe("rejected");
		expect(r.messages.some((m) => m.type === "error")).toBe(false);
		expect(r.messages.some((m) => m.type === "turnEnded")).toBe(true);
		expect(r.session.isRunning).toBe(false);
	});

	it("targets the new range with a second write after an accepted one", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ toolCalls: [writeCall("c1", "First line of prose.\nSecond line of prose.\nThird line of prose.")] });
		server.script({ toolCalls: [writeCall("c2", "One line now.")] });
		server.script({ text: "Done." });
		const sending = r.session.send("Expand, then shrink");
		const first = await r.next("editProposed");
		expect(first.proposal.newLines).toHaveLength(3);
		await r.session.handle({ type: "acceptEdit", id: first.proposal.id });
		const second = await r.next("editProposed", r.messages.indexOf(first) + 1);
		expect(second.proposal.range).toEqual({ start: 1, end: 4 });
		expect(second.proposal.oldLines).toEqual(["// First line of prose.", "// Second line of prose.", "// Third line of prose."]);
		await r.session.handle({ type: "acceptEdit", id: second.proposal.id });
		await sending;

		expect(r.host.text).toBe(["const a = 1;", "// One line now.", "const b = 2;", "const c = 3;"].join("\n"));
		expect(toolResult(server, 2, "c2")).toEqual({ status: "accepted" });
	});

	it("returns the whole numbered file from read_text in file mode", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		await r.session.handle({ type: "setMode", mode: "file" });
		server.script({ toolCalls: [readCall("c1")] });
		server.script({ text: "Read it." });
		await r.session.send("What is around this?");
		expect(toolResult(server, 1, "c1")).toEqual({ text: SOURCE.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n") });
		const system = systemText(server, 0);
		expect(system).toContain("Mode: file.");
	});

	it("returns only the block from read_text in strict mode", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ toolCalls: [readCall("c1")] });
		server.script({ text: "Read it." });
		await r.session.send("Read");
		expect(toolResult(server, 1, "c1")).toEqual({ text: "This comment needs an edit.\nIt spans two lines." });
	});

	it("refuses to resume a thread whose block changed on disk", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ text: "Sure." });
		await r.session.send("Hello");
		const id = r.session.thread!.id;

		r.host.text = SOURCE.replace("two lines", "three lines");
		const before = r.messages.length;
		await r.session.handle({ type: "openThread", id });
		const err = await r.next("error", before);
		expect(err).toEqual({ type: "error", message: BLOCK_CHANGED, fix: "newThread" });
		expect(r.messages.slice(before).find((m) => m.type === "galley")).toEqual({ type: "galley", unit: null });
		const loaded = r.messages.slice(before).find((m) => m.type === "threadLoaded") as Extract<HostToUi, { type: "threadLoaded" }>;
		expect(loaded.thread.id).toBe(id);
		expect(loaded.entries.map((e) => e.kind)).toEqual(["user", "assistant"]);

		server.script({ text: "Ignored." });
		await r.session.send("Again");
		expect(chats(server)).toHaveLength(1);
	});

	it("resumes a thread whose block is unchanged", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ text: "Sure." });
		await r.session.send("Hello");
		const id = r.session.thread!.id;
		await r.session.handle({ type: "newThread" });
		expect(r.session.thread!.id).not.toBe(id);
		const before = r.messages.length;
		await r.session.handle({ type: "openThread", id });
		expect(r.messages.slice(before).some((m) => m.type === "error")).toBe(false);
		const galley = r.messages.slice(before).find((m) => m.type === "galley") as Extract<HostToUi, { type: "galley" }>;
		expect(galley.unit?.range).toEqual({ start: 1, end: 3 });
	});

	it("puts PROSE.md from two directories up after the user prompt", async () => {
		const root = path.join(home, "project");
		const file = path.join(root, "src", "deep", "demo.ts");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(path.join(root, "PROSE.md"), "Prefer short sentences.\n");
		const r = rig(file);
		r.host.settings.systemPrompt = "You are terse.";
		await r.session.handle({ type: "ready" });
		server.script({ text: "Ok." });
		await r.session.send("Hi");

		const system = systemText(server, 0);
		expect(system.indexOf("You are terse.")).toBe(0);
		expect(system.indexOf("## Style guide")).toBeGreaterThan(0);
		expect(system.indexOf("Prefer short sentences.")).toBeGreaterThan(system.indexOf("## Style guide"));
		expect(system.indexOf("Mode: strict.")).toBeGreaterThan(system.indexOf("Prefer short sentences."));
		const loaded = r.messages.find((m) => m.type === "threadLoaded") as Extract<HostToUi, { type: "threadLoaded" }>;
		expect(loaded.proseMd).toEqual({ path: path.join(root, "PROSE.md") });
	});

	it("reports where it searched when there is no PROSE.md", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		const loaded = r.messages.find((m) => m.type === "threadLoaded") as Extract<HostToUi, { type: "threadLoaded" }>;
		expect(loaded.proseMd).toEqual({ searchedFrom: path.dirname(r.host.filePath) });
	});

	it("trims the title to the first message's first sixty characters", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ text: "Ok." });
		const long = "Please rewrite this comment so that it reads more naturally and keeps every technical term intact";
		await r.session.send(long);
		const title = r.session.thread!.title;
		expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
		expect(long.startsWith(title)).toBe(true);
		const headers = await r.store.list();
		expect(headers.map((h) => h.title)).toEqual([title]);
		const threads = r.messages.filter((m) => m.type === "threads").at(-1) as Extract<HostToUi, { type: "threads" }>;
		expect(threads.current.map((h) => h.id)).toEqual([r.session.thread!.id]);
		expect(threads.other).toEqual([]);
	});

	it("starts a new thread when the mode changes", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		const first = r.session.thread!;
		await r.session.handle({ type: "setMode", mode: "file" });
		const second = r.session.thread!;
		expect(second.id).not.toBe(first.id);
		expect(second.mode).toBe("file");
		expect(first.mode).toBe("strict");
		const loaded = r.messages.filter((m) => m.type === "threadLoaded").at(-1) as Extract<HostToUi, { type: "threadLoaded" }>;
		expect(loaded.mode).toBe("file");
	});

	it("asks for a key before sending when none is stored", async () => {
		const r = rig();
		r.host.secrets.clear();
		await r.session.handle({ type: "ready" });
		await r.session.send("Hello");
		expect(chats(server)).toHaveLength(0);
		expect(r.messages.at(-1)).toEqual({ type: "error", message: MISSING_KEY, fix: "apiKey" });
		expect(r.session.thread!.messages).toHaveLength(0);
	});

	it("surfaces a server error with its fix and ends the turn", async () => {
		const r = rig();
		await r.session.handle({ type: "ready" });
		server.script({ status: 401 });
		await r.session.send("Hello");
		const err = r.messages.find((m) => m.type === "error") as Extract<HostToUi, { type: "error" }>;
		expect(err.fix).toBe("apiKey");
		expect(r.messages.at(-2)?.type).toBe("turnEnded");
		expect(r.session.isRunning).toBe(false);
	});

	it("reports no unit when the cursor is outside any comment", async () => {
		const r = rig();
		r.host.line = 0;
		await r.session.handle({ type: "ready" });
		expect(r.messages.filter((m) => m.type === "galley").at(-1)).toMatchObject({ unit: null, reason: expect.any(String) });
		await r.session.send("Hello");
		expect(chats(server)).toHaveLength(0);
		expect(r.messages.at(-1)?.type).toBe("error");
	});
});
