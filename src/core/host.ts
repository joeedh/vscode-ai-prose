import type { LineRange } from "./protocol.js";

export interface Config {
	model: string;
	systemPrompt: string;
	wrapColumn?: number;
	baseUrl: string;
}

export interface HostDocument {
	path: string;
	languageId: string;
	text: string;
}

export interface Cursor {
	line: number;
	character: number;
}

/** What the core needs from the editor it lives in. */
export interface Host {
	document(): Promise<HostDocument>;
	cursor(): Promise<Cursor>;
	/** Replaces the lines of `range` with `text`, which ends without a newline. */
	applyEdit(range: LineRange, text: string): Promise<void>;
	secret(name: string): Promise<string | undefined>;
	setSecret(name: string, value: string): Promise<void>;
	config(): Promise<Config>;
	setConfig(patch: Partial<Config>): Promise<void>;
	clipboardWrite(text: string): Promise<void>;
	openFix(kind: "apiKey" | "newThread"): Promise<void>;
	homeDir(): string;
}
