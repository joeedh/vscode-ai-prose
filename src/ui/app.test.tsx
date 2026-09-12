// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import type { EditProposal, HostToUi, ThreadHeader } from "../core/protocol";
import { App } from "./app";
import { testTransport, type TestTransport } from "./transport";

let root: HTMLElement;
let tt: TestTransport;

function mount() {
	root = document.createElement("div");
	document.body.appendChild(root);
	tt = testTransport();
	render(<App transport={tt.transport} />, root);
}

afterEach(() => {
	render(null, root);
	root.remove();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function emit(...msgs: HostToUi[]) {
	for (const msg of msgs) {
		tt.emit(msg);
	}
	await flush();
}

const thread: ThreadHeader = {
	id: "t1",
	title: "Plainer pointer comment",
	createdAt: "2026-09-12T00:00:00Z",
	updatedAt: "2026-09-12T00:00:00Z",
	filePath: "C:/repo/src/editor/pointer.ts",
	mode: "strict",
	model: "anthropic/claude-sonnet-5",
};

const loaded: HostToUi = {
	type: "threadLoaded",
	thread,
	mode: "strict",
	model: "anthropic/claude-sonnet-5",
	systemPrompt: "Be plain.",
	defaultSystemPrompt: "Default prompt.",
	proseMd: { path: "C:/repo/PROSE.md" },
	entries: [],
	usage: { turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 },
};

const models: HostToUi = {
	type: "models",
	groups: [
		{ label: "Anthropic", ids: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"] },
		{ label: "Z.ai", ids: ["z-ai/glm-5.3-flash"] },
	],
};

const proposal: EditProposal = {
	id: "e1",
	range: { start: 37, end: 40 },
	firstLine: 34,
	contextBefore: ["", "  private captured = false;", ""],
	oldLines: ["  // keeps track", "  // of pointers", "  // in the set"],
	newLines: ["  // Pointer ids currently down.", "  // More than one means multi-touch."],
	contextAfter: ["  private down = new Set<number>();", "", "  constructor(el: HTMLElement) {"],
	text: "  // Pointer ids currently down.\n  // More than one means multi-touch.",
};

const q = (sel: string) => root.querySelector(sel) as HTMLElement;
const text = (sel: string) => q(sel)?.textContent ?? "";
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
	const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(ev);
	return ev;
};
const type = (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
};
const choose = (el: HTMLSelectElement, value: string) => {
	el.value = value;
	el.dispatchEvent(new Event("change", { bubbles: true }));
};
const buttonNamed = (label: string) =>
	Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

describe("App", () => {
	it("posts ready on mount and shows the empty state", () => {
		mount();
		expect(tt.posted).toEqual([{ type: "ready" }]);
		expect(text(".galley")).toContain("Put the cursor in a comment or a paragraph to start.");
	});

	it("renders the galley from a unit", async () => {
		mount();
		await emit(loaded, {
			type: "galley",
			unit: { kind: "lineRun", label: "one // run", range: { start: 37, end: 40 }, original: "", text: "keeps track", width: 80 },
		});
		expect(text(".galley .margin")).toContain("C:/repo/src/editor/pointer.ts");
		expect(text(".galley .margin")).toContain("lines 38–40");
		expect(text(".galley .margin")).toContain("one // run");
		expect(text(".galley .margin")).toContain("Style from ../../PROSE.md");
		expect(text(".galley p")).toBe("keeps track");
	});

	it("shows the reason when the cursor is in a code block", async () => {
		mount();
		await emit({ type: "galley", unit: null, reason: "The cursor is in a code block" });
		expect(text(".galley")).toContain("The cursor is in a code block");
	});

	it("collapses a whole-file galley behind Show all", async () => {
		mount();
		await emit(loaded, {
			type: "galley",
			unit: { kind: "file", label: "whole file", range: { start: 0, end: 5 }, original: "", text: "1\n2\n3\n4\n5", width: 80 },
		});
		expect(text(".galley .margin")).toContain("whole file");
		expect(text(".galley p")).toBe("1\n2\n3");
		buttonNamed("Show all").click();
		await flush();
		expect(text(".galley p")).toBe("1\n2\n3\n4\n5");
	});

	it("streams an assistant message with activity and a caret", async () => {
		mount();
		await emit(loaded, { type: "turnStarted" }, { type: "activity", label: "Read the block" }, { type: "activity", label: "Checked the edit range" }, { type: "messageDelta", text: "Split it " }, { type: "messageDelta", text: "in two." });
		expect(text(".msg.assistant .who")).toBe("Editor");
		expect(text(".msg.assistant .activity")).toBe("Read the block · Checked the edit range");
		expect(text(".msg.assistant p")).toBe("Split it in two.");
		expect(q(".caret")).not.toBeNull();
		expect(buttonNamed("Stop")).toBeDefined();
		await emit({ type: "turnEnded" });
		expect(q(".caret")).toBeNull();
		expect(buttonNamed("Send")).toBeDefined();
	});

	it("renders the proposed edit as a preview and toggles to the diff", async () => {
		mount();
		await emit(loaded, { type: "editProposed", proposal });
		expect(text(".edit.pending .head")).toContain("Proposed edit");
		expect(text(".edit.pending .head")).toContain("lines 38–40");
		const previewLines = Array.from(root.querySelectorAll(".body.preview .ln"));
		expect(previewLines.map((l) => l.querySelector(".n")!.textContent)).toEqual(["35", "36", "37", "38", "39", "40", "41", "42"]);
		expect(previewLines[3].className).toBe("ln hot");
		expect(previewLines[3].textContent).toContain("Pointer ids currently down.");
		expect(q(".body.preview .del")).toBeNull();

		buttonNamed("Diff").click();
		await flush();
		expect(q(".body.diff")).not.toBeNull();
		const dels = Array.from(root.querySelectorAll(".body.diff .ln.del"));
		const adds = Array.from(root.querySelectorAll(".body.diff .ln.add"));
		expect(dels.map((l) => l.querySelector(".n")!.textContent)).toEqual(["38", "39", "40"]);
		expect(adds.map((l) => l.querySelector(".n")!.textContent)).toEqual(["38", "39"]);
		expect(dels[0].querySelector(".sr")!.textContent).toBe("removed ");
		expect(adds[0].querySelector(".sr")!.textContent).toBe("added ");
		expect(q('[role="radio"][aria-checked="true"]', ).textContent).toBe("Strict");

		buttonNamed("Preview").click();
		await flush();
		expect(q(".body.preview")).not.toBeNull();
	});

	it("accepts with Enter and rejects with Escape on the focused card", async () => {
		mount();
		await emit(loaded, { type: "editProposed", proposal });
		const card = q(".edit.pending");
		card.focus();
		key(card, "Enter");
		expect(tt.posted).toContainEqual({ type: "acceptEdit", id: "e1" });
		key(card, "Escape");
		expect(tt.posted).toContainEqual({ type: "rejectEdit", id: "e1" });
	});

	it("posts accept and reject from the footer buttons", async () => {
		mount();
		await emit(loaded, { type: "editProposed", proposal });
		buttonNamed("Reject").click();
		buttonNamed("Accept edit").click();
		expect(tt.posted.slice(1)).toEqual([
			{ type: "rejectEdit", id: "e1" },
			{ type: "acceptEdit", id: "e1" },
		]);
	});

	it("collapses an accepted edit and reopens its diff", async () => {
		mount();
		await emit(loaded, { type: "editProposed", proposal }, {
			type: "editResolved",
			resolution: { id: "e1", status: "accepted", range: { start: 37, end: 39 }, text: proposal.text },
		});
		expect(q(".edit.pending")).toBeNull();
		expect(text(".edit.accepted")).toContain("Applied to lines 38–39");
		expect(q(".edit.accepted .body")).toBeNull();
		q(".edit.accepted .applied").click();
		await flush();
		expect(q(".edit.accepted .body.diff")).not.toBeNull();
		expect(q(".edit.accepted .foot")).toBeNull();
	});

	it("keeps a rejected edit with its text and copies it", async () => {
		mount();
		await emit(loaded, { type: "editProposed", proposal }, {
			type: "editResolved",
			resolution: { id: "e1", status: "rejected", range: proposal.range, text: proposal.text },
		});
		expect(text(".edit.rejected .head")).toContain("Rejected edit");
		expect(text(".edit.rejected pre")).toBe(proposal.text);
		buttonNamed("Copy").click();
		expect(tt.posted).toContainEqual({ type: "copy", text: proposal.text });
	});

	it("sends on Enter and leaves Shift+Enter to the textarea", async () => {
		mount();
		await emit(loaded);
		const ta = q("textarea") as HTMLTextAreaElement;
		type(ta, "Make it plainer");
		const shifted = key(ta, "Enter", { shiftKey: true });
		expect(shifted.defaultPrevented).toBe(false);
		expect(tt.posted.find((m) => m.type === "send")).toBeUndefined();

		const plain = key(ta, "Enter");
		expect(plain.defaultPrevented).toBe(true);
		expect(tt.posted).toContainEqual({ type: "send", text: "Make it plainer" });
		await flush();
		expect(text(".msg.user p")).toBe("Make it plainer");
		expect((q("textarea") as HTMLTextAreaElement).value).toBe("");
		expect(buttonNamed("Stop")).toBeDefined();
	});

	it("grows the composer up to six rows", async () => {
		mount();
		const ta = q("textarea") as HTMLTextAreaElement;
		type(ta, "1\n2\n3");
		await flush();
		expect(q("textarea").getAttribute("rows")).toBe("3");
		type(q("textarea") as HTMLTextAreaElement, "1\n2\n3\n4\n5\n6\n7\n8");
		await flush();
		expect(q("textarea").getAttribute("rows")).toBe("6");
	});

	it("posts stop while a turn runs", async () => {
		mount();
		await emit(loaded, { type: "turnStarted" });
		buttonNamed("Stop").click();
		expect(tt.posted).toContainEqual({ type: "stop" });
	});

	it("shows the usage line from the final chunk", async () => {
		mount();
		await emit(loaded, {
			type: "usage",
			usage: { turns: 2, promptTokens: 2800, completionTokens: 300, cachedTokens: 2184, cost: 0.004 },
		});
		expect(text(".usage")).toBe("2 turns · 3.1k tokens · 78% from cache · $0.004");
	});

	it("renders an error with its fix link", async () => {
		mount();
		await emit(loaded, { type: "error", message: "OpenRouter rejected the key. Set a new one.", fix: "apiKey" });
		expect(text(".error")).toContain("OpenRouter rejected the key. Set a new one.");
		q(".error .link").click();
		expect(tt.posted).toContainEqual({ type: "openFix", kind: "apiKey" });
	});

	it("posts setMode when the segment changes", async () => {
		mount();
		await emit(loaded);
		buttonNamed("File").click();
		expect(tt.posted).toContainEqual({ type: "setMode", mode: "file" });
		buttonNamed("Strict").click();
		expect(tt.posted.filter((m) => m.type === "setMode")).toHaveLength(1);
	});

	it("lists models in groups and posts setModel", async () => {
		mount();
		await emit(loaded, models);
		const sel = q(".model-sel") as HTMLSelectElement;
		expect(Array.from(sel.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["Anthropic", "Z.ai"]);
		expect(sel.value).toBe("anthropic/claude-sonnet-5");
		choose(sel, "z-ai/glm-5.3-flash");
		expect(tt.posted).toContainEqual({ type: "setModel", model: "z-ai/glm-5.3-flash" });
	});

	it("reveals the Other field and posts the typed id", async () => {
		mount();
		await emit(loaded, models);
		choose(q(".model-sel") as HTMLSelectElement, "__other");
		await flush();
		const field = q(".model-other") as HTMLInputElement;
		expect(field).not.toBeNull();
		type(field, "mistralai/mistral-large");
		key(field, "Enter");
		expect(tt.posted).toContainEqual({ type: "setModel", model: "mistralai/mistral-large" });
	});

	it("selects Other with the id filled when the model is not listed", async () => {
		mount();
		await emit({ ...loaded, model: "mistralai/mistral-large" }, models);
		expect((q(".model-sel") as HTMLSelectElement).value).toBe("__other");
		expect((q(".model-other") as HTMLInputElement).value).toBe("mistralai/mistral-large");
	});

	it("keeps the chosen model through later host messages", async () => {
		mount();
		await emit(loaded, models);
		const sel = q(".model-sel") as HTMLSelectElement;
		choose(sel, "z-ai/glm-5.3-flash");
		await emit(models, { type: "threads", current: [thread], other: [] }, { type: "turnStarted" }, { type: "messageDelta", text: "hi" });
		expect((q(".model-sel") as HTMLSelectElement).value).toBe("z-ai/glm-5.3-flash");
		choose(q(".model-sel") as HTMLSelectElement, "__other");
		await flush();
		const field = q(".model-other") as HTMLInputElement;
		type(field, "mistralai/mistral-large");
		key(field, "Enter");
		await emit(models);
		expect((q(".model-sel") as HTMLSelectElement).value).toBe("__other");
		expect((q(".model-other") as HTMLInputElement).value).toBe("mistralai/mistral-large");
	});

	it("hides the Other field once the model list arrives with the current model", async () => {
		mount();
		await emit(loaded);
		expect(q(".model-other")).not.toBeNull();
		await emit(models);
		expect(q(".model-other")).toBeNull();
		expect((q(".model-sel") as HTMLSelectElement).value).toBe("anthropic/claude-sonnet-5");
	});

	it("lists threads with the current file first and posts openThread and newThread", async () => {
		mount();
		await emit(loaded, {
			type: "threads",
			current: [thread, { ...thread, id: "t2", title: "Caption on the onDown note" }],
			other: [{ ...thread, id: "t3", title: "README install paragraph", filePath: "C:/repo/README.md" }],
		});
		const sel = q(".thread-sel") as HTMLSelectElement;
		const labels = Array.from(sel.options).map((o) => o.textContent);
		expect(labels[0]).toBe("Plainer pointer comment");
		expect(labels[1]).toBe("New thread");
		expect(labels.indexOf("Caption on the onDown note")).toBeLessThan(labels.indexOf("README install paragraph"));
		expect(sel.value).toBe("t1");
		choose(sel, "t3");
		expect(tt.posted).toContainEqual({ type: "openThread", id: "t3" });
		choose(sel, "__new");
		expect(tt.posted).toContainEqual({ type: "newThread" });
	});

	it("opens the system prompt sheet with the PROSE.md path and saves", async () => {
		mount();
		await emit(loaded);
		buttonNamed("System prompt").click();
		await flush();
		expect(text(".sheet .margin")).toContain("Style guide found at ../../PROSE.md");
		const ta = q(".sheet textarea") as HTMLTextAreaElement;
		expect(ta.value).toBe("Be plain.");
		buttonNamed("Reset to default").click();
		await flush();
		expect((q(".sheet textarea") as HTMLTextAreaElement).value).toBe("Default prompt.");
		buttonNamed("Save").click();
		await flush();
		expect(tt.posted).toContainEqual({ type: "setSystemPrompt", text: "Default prompt." });
		expect(q(".sheet")).toBeNull();
	});

	it("says where the PROSE.md search started when none was found", async () => {
		mount();
		await emit({ ...loaded, proseMd: { searchedFrom: "C:/repo/src/editor" } });
		buttonNamed("System prompt").click();
		await flush();
		expect(text(".sheet .margin")).toContain("No PROSE.md found. Searched upward from C:/repo/src/editor.");
	});

	it("restores entries from a loaded thread", async () => {
		mount();
		await emit({
			...loaded,
			entries: [
				{ kind: "user", text: "Shorter." },
				{ kind: "assistant", text: "Done.", activity: ["Read the block"] },
				{ kind: "edit", proposal, resolution: { id: "e1", status: "rejected", range: proposal.range, text: "x" } },
			],
		});
		expect(root.querySelectorAll(".msg").length).toBe(3);
		expect(root.querySelectorAll(".msg .who").length).toBe(2);
		expect(q(".edit.rejected")).not.toBeNull();
	});

	it("never sets a string style attribute", async () => {
		mount();
		await emit(loaded, models, { type: "editProposed", proposal }, { type: "usage", usage: { turns: 1, promptTokens: 1, completionTokens: 1, cachedTokens: 0, cost: 0 } });
		buttonNamed("System prompt").click();
		await flush();
		expect(root.querySelector("[style]")).toBeNull();
	});
});
