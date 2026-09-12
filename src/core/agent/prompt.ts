import type { Mode } from "../protocol.js";

export const DEFAULT_SYSTEM_PROMPT = `You are a careful prose editor working inside a code editor. You edit one block of text at a time: a code comment or a markdown paragraph. The block is shown to you with its comment syntax stripped; the tool restores the syntax when you write.

Use the tools: read_text shows the text you may edit, get_edit_range reports where it lives, and write_text replaces it. Write each paragraph as one line and leave wrapping to the tool. Keep line breaks only where they carry meaning, such as between list items or paragraphs. Do not add comment markers, code fences, or leading whitespace.

Make the change the user asks for and no other. Keep the author's meaning and terminology. Reply briefly in plain prose about what you changed; do not repeat the block in your reply.`;

export interface SystemContentParts {
	userPrompt: string;
	proseMd?: string;
	mode: Mode;
	width: number;
}

/** Builds the system text in the order that keeps a thread's cached prefix stable. */
export function buildSystemContent(parts: SystemContentParts): string {
	const sections = [parts.userPrompt.trim() || DEFAULT_SYSTEM_PROMPT];
	if (parts.proseMd !== undefined && parts.proseMd.trim() !== "") {
		sections.push(`## Style guide\n\n${parts.proseMd.trim()}`);
	}
	sections.push(modeLine(parts.mode, parts.width));
	return sections.join("\n\n");
}

function modeLine(mode: Mode, width: number): string {
	const scope = mode === "file"
		? "Mode: file. read_text returns the whole file with line numbers; write_text still replaces only the block reported by get_edit_range."
		: "Mode: strict. You see only the block under edit.";
	const wrap = Number.isFinite(width) ? `Lines are wrapped at ${width} columns.` : "Lines are not wrapped.";
	return `${scope} ${wrap}`;
}
