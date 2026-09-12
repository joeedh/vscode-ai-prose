// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import type { HostToUi, UiToHost } from "../core/protocol";
import type { ElectronBridge, FileState } from "../electron/bridge";
import { Shell } from "./shell";

interface FakeBridge extends ElectronBridge {
	posted: UiToHost[];
	cursors: number[];
	emit(msg: HostToUi): void;
	emitFile(state: FileState | null): void;
}

function fakeBridge(): FakeBridge {
	const hostListeners: ((msg: HostToUi) => void)[] = [];
	const fileListeners: ((state: FileState | null) => void)[] = [];
	const bridge: FakeBridge = {
		posted: [],
		cursors: [],
		post: (msg) => {
			bridge.posted.push(msg);
		},
		onMessage: (cb) => {
			hostListeners.push(cb);
		},
		onFile: (cb) => {
			fileListeners.push(cb);
		},
		setCursor: (line) => {
			bridge.cursors.push(line);
		},
		emit: (msg) => hostListeners.forEach((cb) => cb(msg)),
		emitFile: (state) => fileListeners.forEach((cb) => cb(state)),
	};
	return bridge;
}

let root: HTMLElement;

afterEach(() => {
	render(null, root);
	root.remove();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount() {
	root = document.createElement("div");
	document.body.appendChild(root);
	const bridge = fakeBridge();
	render(<Shell bridge={bridge} />, root);
	await flush();
	return bridge;
}

const file: FileState = { path: "C:/repo/src/a.ts", text: "const a = 1;\n// one\n// two\nconst b = 2;", cursorLine: 1 };

describe("Shell", () => {
	it("shows a hint until a file is open", async () => {
		const bridge = await mount();
		expect(root.querySelector(".file-title")?.textContent).toBe("No file open");
		expect(bridge.posted).toEqual([{ type: "ready" }]);
	});

	it("renders the file with numbered lines and the cursor", async () => {
		const bridge = await mount();
		bridge.emitFile(file);
		await flush();
		expect(root.querySelector(".file-title")?.textContent).toBe(file.path);
		const lines = [...root.querySelectorAll(".file-body .ln")];
		expect(lines).toHaveLength(4);
		expect(lines[1].querySelector(".n")?.textContent).toBe("2");
		expect(lines[1].querySelector(".c")?.textContent).toBe("// one");
		expect(lines[1].classList.contains("cursor")).toBe(true);
		expect(root.querySelectorAll(".ln.cursor")).toHaveLength(1);
	});

	it("marks the galley's unit and reports clicks as cursor moves", async () => {
		const bridge = await mount();
		bridge.emitFile(file);
		bridge.emit({
			type: "galley",
			unit: { kind: "lineRun", label: "comment", range: { start: 1, end: 3 }, original: "// one\n// two", text: "one\ntwo", width: 60 },
		});
		await flush();
		const marked = [...root.querySelectorAll(".file-body .ln.unit")].map((el) => el.querySelector(".n")?.textContent);
		expect(marked).toEqual(["2", "3"]);
		(root.querySelectorAll(".file-body .ln")[3] as HTMLElement).click();
		expect(bridge.cursors).toEqual([3]);
		bridge.emit({ type: "galley", unit: null });
		await flush();
		expect(root.querySelectorAll(".ln.unit")).toHaveLength(0);
	});
});
