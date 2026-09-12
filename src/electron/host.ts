import { clipboard, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Config, Host, HostDocument } from "../core/host.js";
import { DEFAULT_BASE_URL } from "../core/llm/index.js";
import type { LineRange } from "../core/protocol.js";
import { resolveLanguage } from "../core/units/index.js";
import type { FileState } from "./bridge.js";

export const SECRETS_FILE = "secrets.json";
export const SETTINGS_FILE = "settings.json";
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

interface LoadedFile {
	path: string;
	lines: string[];
	eol: "\n" | "\r\n";
}

/** Serves one file from disk and keeps secrets and settings as JSON in the profile directory. */
export class ElectronHost implements Host {
	private file: LoadedFile | undefined;
	private cursorLine = 0;
	onFileChange: (state: FileState | null) => void = () => {};
	onNewThread: () => Promise<void> = async () => {};

	constructor(readonly profileDir: string, private readonly home: string) {}

	get hasFile(): boolean {
		return this.file !== undefined;
	}

	get filePath(): string | undefined {
		return this.file?.path;
	}

	fileState(): FileState | null {
		if (!this.file) {
			return null;
		}
		return { path: this.file.path, text: this.file.lines.join("\n"), cursorLine: this.cursorLine };
	}

	openFile(filePath: string): void {
		const raw = fs.readFileSync(filePath, "utf8");
		this.file = { path: filePath, lines: raw.split(/\r?\n/), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
		this.cursorLine = 0;
		this.onFileChange(this.fileState());
	}

	setCursor(line: number): void {
		if (!this.file) {
			return;
		}
		this.cursorLine = Math.max(0, Math.min(line, this.file.lines.length - 1));
		this.onFileChange(this.fileState());
	}

	async document(): Promise<HostDocument> {
		if (!this.file) {
			return { path: "", languageId: "plaintext", text: "" };
		}
		const languageId = resolveLanguage("plaintext", this.file.path) ?? "plaintext";
		return { path: this.file.path, languageId, text: this.file.lines.join("\n") };
	}

	async cursor() {
		return { line: this.cursorLine, character: 0 };
	}

	async applyEdit(range: LineRange, text: string): Promise<void> {
		const file = this.file;
		if (!file) {
			throw new Error("No file is open.");
		}
		file.lines.splice(range.start, range.end - range.start, ...text.split("\n"));
		fs.writeFileSync(file.path, file.lines.join(file.eol), "utf8");
		this.onFileChange(this.fileState());
	}

	async secret(name: string): Promise<string | undefined> {
		const value = this.readJson(SECRETS_FILE)[name];
		return typeof value === "string" && value !== "" ? value : undefined;
	}

	async setSecret(name: string, value: string): Promise<void> {
		this.writeJson(SECRETS_FILE, { ...this.readJson(SECRETS_FILE), [name]: value });
	}

	async config(): Promise<Config> {
		const stored = this.readJson(SETTINGS_FILE);
		const config: Config = {
			model: typeof stored.model === "string" ? stored.model : DEFAULT_MODEL,
			systemPrompt: typeof stored.systemPrompt === "string" ? stored.systemPrompt : "",
			baseUrl: process.env.AIPROSE_BASE_URL ?? (typeof stored.baseUrl === "string" ? stored.baseUrl : DEFAULT_BASE_URL),
		};
		if (typeof stored.wrapColumn === "number") {
			config.wrapColumn = stored.wrapColumn;
		}
		return config;
	}

	async setConfig(patch: Partial<Config>): Promise<void> {
		this.writeJson(SETTINGS_FILE, { ...this.readJson(SETTINGS_FILE), ...patch });
	}

	async clipboardWrite(text: string): Promise<void> {
		clipboard.writeText(text);
	}

	async openFix(kind: "apiKey" | "newThread"): Promise<void> {
		if (kind === "newThread") {
			await this.onNewThread();
			return;
		}
		const file = path.join(this.profileDir, SECRETS_FILE);
		if (!fs.existsSync(file)) {
			this.writeJson(SECRETS_FILE, { openrouterApiKey: "" });
		}
		await shell.openPath(file);
	}

	homeDir(): string {
		return this.home;
	}

	private readJson(name: string): Record<string, unknown> {
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.profileDir, name), "utf8"));
			return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}

	private writeJson(name: string, value: Record<string, unknown>): void {
		fs.mkdirSync(this.profileDir, { recursive: true });
		fs.writeFileSync(path.join(this.profileDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
	}
}
