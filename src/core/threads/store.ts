import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { EditProposal, EditResolution, LineRange, ThreadHeader, Unit, UnitKind, Usage } from "../protocol.js";

/** The block a thread was started on, kept so a resume can check it is unchanged. */
export interface StoredUnit {
	range: LineRange;
	kind: UnitKind;
	label: string;
	original: string;
	text: string;
	width: number;
}

/** One transcript file. `messages` holds the OpenAI-format array sent to the model. */
export interface Thread extends ThreadHeader {
	languageId: string;
	/** The full resolved system text sent to the model. */
	systemPrompt: string;
	/** The user's own prompt before PROSE.md and the mode line were appended. */
	userPrompt: string;
	proseMdPath?: string;
	/** Where the PROSE.md search started when none was found. */
	proseMdSearchedFrom?: string;
	/** Null once a resume finds the block changed on disk. */
	unit: StoredUnit | null;
	messages: unknown[];
	usage: Usage;
	edits: StoredEdit[];
}

/** A write the user has answered, kept with its proposal so a resume can show the card. */
export interface StoredEdit {
	/** The tool call id of the write, so the card lands beside the right assistant turn. */
	callId: string;
	proposal: EditProposal;
	resolution: EditResolution;
}

export const TITLE_MAX = 60;

const HEADER_KEYS: (keyof ThreadHeader)[] = ["id", "title", "createdAt", "updatedAt", "filePath", "mode", "model"];

/** Reads and writes one JSON file per thread under `<home>/.aiprose/transcripts`. */
export class ThreadStore {
	readonly dir: string;

	constructor(homeDir: string) {
		this.dir = path.join(homeDir, ".aiprose", "transcripts");
	}

	static newId(now = new Date()): string {
		const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
		const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
		return `${stamp}-${suffix}`;
	}

	static titleFor(firstUserMessage: string): string {
		const flat = firstUserMessage.replace(/\s+/g, " ").trim();
		return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX).trimEnd() : flat;
	}

	create(init: Omit<Thread, "id" | "createdAt" | "updatedAt">): Thread {
		const now = new Date().toISOString();
		return { ...init, id: ThreadStore.newId(), createdAt: now, updatedAt: now };
	}

	fileFor(id: string): string {
		return path.join(this.dir, `${id}.json`);
	}

	// The header goes on line 1 so list() can read it without parsing the messages
	async save(thread: Thread): Promise<void> {
		await fs.mkdir(this.dir, { recursive: true });
		thread.updatedAt = new Date().toISOString();
		const header = Object.fromEntries(HEADER_KEYS.map((k) => [k, thread[k]]));
		const body: Record<string, unknown> = { ...thread };
		for (const k of HEADER_KEYS) {
			delete body[k];
		}
		const text = `{"header":${JSON.stringify(header)},\n"body":${JSON.stringify(body, null, 1)}}\n`;
		const file = this.fileFor(thread.id);
		await fs.writeFile(`${file}.tmp`, text, "utf8");
		await fs.rename(`${file}.tmp`, file);
	}

	async load(id: string): Promise<Thread> {
		const raw = JSON.parse(await fs.readFile(this.fileFor(id), "utf8")) as { header: ThreadHeader; body: Omit<Thread, keyof ThreadHeader> };
		return { ...raw.header, ...raw.body };
	}

	/** Lists headers newest first. */
	async list(): Promise<ThreadHeader[]> {
		let names: string[];
		try {
			names = await fs.readdir(this.dir);
		} catch {
			return [];
		}
		const headers: ThreadHeader[] = [];
		for (const name of names.filter((n) => n.endsWith(".json")).sort().reverse()) {
			const header = await this.readHeader(path.join(this.dir, name));
			if (header) {
				headers.push(header);
			}
		}
		return headers;
	}

	private async readHeader(file: string): Promise<ThreadHeader | undefined> {
		const handle = await fs.open(file, "r");
		try {
			const buf = Buffer.alloc(4096);
			const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
			const firstLine = buf.toString("utf8", 0, bytesRead).split("\n")[0];
			const match = /^\{"header":(\{.*\}),$/.exec(firstLine);
			return match ? (JSON.parse(match[1]) as ThreadHeader) : undefined;
		} catch {
			return undefined;
		} finally {
			await handle.close();
		}
	}
}

/** Splits headers into those for `filePath` and the rest, both keeping their order. */
export function groupByFile(headers: ThreadHeader[], filePath: string): { current: ThreadHeader[]; other: ThreadHeader[] } {
	const current = headers.filter((h) => h.filePath === filePath);
	const other = headers.filter((h) => h.filePath !== filePath);
	return { current, other };
}

export function unitToStored(unit: Unit): StoredUnit {
	const { range, kind, label, original, text, width } = unit;
	return { range, kind, label, original, text, width };
}
