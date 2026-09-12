import type { LineRange, Unit, UnitKind } from "../protocol.js";
import { ATX, layoutBlock, layoutLineRun, layoutMarkdown, LIST_ITEM, linePrefixPattern, openerEnd, QUOTE, type Layout } from "./layout.js";
import { MARKDOWN, resolveLanguage, syntaxFor, type BlockSyntax } from "./languages.js";
import { derivedWidth, MAX_WIDTH, NO_WRAP } from "./wrap.js";

export type UnitResult = { ok: true; unit: Unit } | { ok: false; reason: string };

export const NO_SYNTAX = "No comment syntax known for this file";
export const IN_CODE_BLOCK = "The cursor is in a code block";
export const IN_FRONT_MATTER = "The cursor is in front matter";
export const IN_TABLE = "The cursor is in a table";
export const NOT_IN_UNIT = "Put the cursor in a comment or a paragraph to start.";

export interface DetectOptions {
	wrapColumn?: number;
}

interface Found {
	kind: UnitKind;
	label: string;
	range: LineRange;
	layout: Layout;
}

function fail(reason: string): UnitResult {
	return { ok: false, reason };
}

/** Detects the unit under `cursorLine`. `wrapColumn` overrides the derived width. */
export function detectUnit(text: string, languageId: string, filePath: string, cursorLine: number, opts: DetectOptions = {}): UnitResult {
	const lang = resolveLanguage(languageId, filePath);
	if (!lang) {
		return fail(NO_SYNTAX);
	}
	const lines = text.split(/\r?\n/);
	if (cursorLine < 0 || cursorLine >= lines.length) {
		return fail(NOT_IN_UNIT);
	}
	const found = lang === MARKDOWN ? detectMarkdown(lines, cursorLine) : detectComment(lines, cursorLine, lang);
	if (typeof found === "string") {
		return fail(found);
	}
	const original = lines.slice(found.range.start, found.range.end);
	let width: number;
	if (found.kind === "heading") {
		width = NO_WRAP;
	} else if (opts.wrapColumn !== undefined) {
		width = opts.wrapColumn;
	} else if (lang === MARKDOWN && original.some((l) => l.length > MAX_WIDTH)) {
		width = NO_WRAP;
	} else {
		width = derivedWidth(original);
	}
	return {
		ok: true,
		unit: {
			kind: found.kind,
			label: found.label,
			range: found.range,
			original: original.join("\n"),
			text: found.layout.lines.join("\n"),
			width,
		},
	};
}

function isShebang(lines: string[], index: number): boolean {
	return index === 0 && lines[0].startsWith("#!");
}

function detectComment(lines: string[], cursor: number, lang: string): Found | string {
	const syntax = syntaxFor(lang)!;
	const marker = syntax.line;
	const block = syntax.block;
	const isLineComment = (i: number): boolean => {
		if (!marker || isShebang(lines, i)) {
			return false;
		}
		const trimmed = lines[i].trimStart();
		if (block && (trimmed.startsWith(block.open) || trimmed.startsWith(block.close))) {
			return false;
		}
		return linePrefixPattern(marker).test(lines[i]);
	};

	if (isLineComment(cursor)) {
		let start = cursor;
		while (start > 0 && isLineComment(start - 1)) {
			start--;
		}
		let end = cursor + 1;
		while (end < lines.length && isLineComment(end)) {
			end++;
		}
		const range = { start, end };
		return { kind: "lineRun", label: `one ${marker} run`, range, layout: layoutLineRun(lines.slice(start, end), marker!) };
	}
	if (block) {
		const range = findBlock(lines, cursor, block);
		if (range) {
			return {
				kind: "block",
				label: `one ${block.open} ${block.close} block`,
				range,
				layout: layoutBlock(lines.slice(range.start, range.end), block),
			};
		}
	}
	return NOT_IN_UNIT;
}

/** Finds the block comment containing `cursor` by taking the nearest opener above it whose closer is at or after it. */
function findBlock(lines: string[], cursor: number, block: BlockSyntax): LineRange | undefined {
	for (let i = cursor; i >= 0; i--) {
		let from = lines[i].length;
		while (true) {
			const openIdx = lines[i].lastIndexOf(block.open, from - 1);
			if (openIdx < 0 || from <= 0) {
				break;
			}
			const closeAt = findCloser(lines, i, openerEnd(lines[i], openIdx, block.open), block.close);
			if (!closeAt) {
				return undefined;
			}
			if (closeAt.line >= cursor) {
				return { start: i, end: closeAt.line + 1 };
			}
			if (i < cursor) {
				return undefined;
			}
			from = openIdx;
		}
	}
	return undefined;
}

function findCloser(lines: string[], line: number, column: number, close: string): { line: number } | undefined {
	for (let i = line; i < lines.length; i++) {
		const idx = lines[i].indexOf(close, i === line ? column : 0);
		if (idx >= 0) {
			return { line: i };
		}
	}
	return undefined;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const THEMATIC = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const SETEXT = /^ {0,3}(=+|-+) *$/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const INDENTED = /^(?: {4}|\t)/;

interface MarkdownScan {
	fenced: boolean[];
	frontMatter: boolean[];
}

/** Marks the lines inside fenced code and front matter, fence delimiters included. */
function scanMarkdown(lines: string[]): MarkdownScan {
	const fenced = new Array<boolean>(lines.length).fill(false);
	const frontMatter = new Array<boolean>(lines.length).fill(false);
	let start = 0;
	if (lines.length > 0 && lines[0].trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			const t = lines[i].trim();
			if (t === "---" || t === "...") {
				frontMatter.fill(true, 0, i + 1);
				start = i + 1;
				break;
			}
		}
	}
	let open: { char: string; len: number } | undefined;
	for (let i = start; i < lines.length; i++) {
		const m = FENCE.exec(lines[i]);
		if (open) {
			fenced[i] = true;
			if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === "") {
				open = undefined;
			}
		} else if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
			open = { char: m[1][0], len: m[1].length };
			fenced[i] = true;
		}
	}
	return { fenced, frontMatter };
}

function detectMarkdown(lines: string[], cursor: number): Found | string {
	const scan = scanMarkdown(lines);
	if (scan.fenced[cursor]) {
		return IN_CODE_BLOCK;
	}
	if (scan.frontMatter[cursor]) {
		return IN_FRONT_MATTER;
	}
	const line = lines[cursor];
	if (line.trim() === "") {
		return NOT_IN_UNIT;
	}
	const inRun = (i: number): boolean => i >= 0 && i < lines.length && lines[i].trim() !== "" && !scan.fenced[i] && !scan.frontMatter[i];
	let runStart = cursor;
	while (inRun(runStart - 1)) {
		runStart--;
	}
	let runEnd = cursor + 1;
	while (inRun(runEnd)) {
		runEnd++;
	}
	const run = lines.slice(runStart, runEnd);

	if (run.some((l) => l.includes("|")) && run.some((l) => l.includes("|") && TABLE_DELIM.test(l))) {
		return IN_TABLE;
	}
	if (ATX.test(line)) {
		return heading({ start: cursor, end: cursor + 1 }, lines);
	}
	if (INDENTED.test(run[0]) && !LIST_ITEM.test(run[0])) {
		return IN_CODE_BLOCK;
	}
	if (SETEXT.test(line)) {
		if (cursor > runStart) {
			const start = paragraphStart(lines, cursor - 1, runStart);
			return heading({ start, end: cursor + 1 }, lines);
		}
		return NOT_IN_UNIT;
	}
	if (THEMATIC.test(line)) {
		return NOT_IN_UNIT;
	}
	if (QUOTE.test(line)) {
		const isQuoteLine = (i: number): boolean => inRun(i) && QUOTE.test(lines[i]) && lines[i].replace(QUOTE, "").trim() !== "";
		let start = cursor;
		while (isQuoteLine(start - 1)) {
			start--;
		}
		let end = cursor + 1;
		while (isQuoteLine(end)) {
			end++;
		}
		const range = { start, end };
		return { kind: "blockquote", label: "blockquote", range, layout: layoutMarkdown(lines.slice(start, end), "blockquote") };
	}
	const boundary = (i: number): boolean => LIST_ITEM.test(lines[i]) || ATX.test(lines[i]) || QUOTE.test(lines[i]) || SETEXT.test(lines[i]) || THEMATIC.test(lines[i]);
	let itemLine = -1;
	for (let i = cursor; i >= runStart; i--) {
		if (LIST_ITEM.test(lines[i])) {
			itemLine = i;
			break;
		}
		if (boundary(i)) {
			break;
		}
	}
	if (itemLine >= 0) {
		let end = itemLine + 1;
		while (end < runEnd && !boundary(end)) {
			end++;
		}
		const range = { start: itemLine, end };
		return { kind: "listItem", label: "list item", range, layout: layoutMarkdown(lines.slice(itemLine, end), "listItem") };
	}
	const start = paragraphStart(lines, cursor, runStart);
	let end = cursor + 1;
	while (end < runEnd && !boundary(end)) {
		end++;
	}
	if (end < runEnd && SETEXT.test(lines[end])) {
		return heading({ start, end: end + 1 }, lines);
	}
	const range = { start, end };
	return { kind: "paragraph", label: "paragraph", range, layout: layoutMarkdown(lines.slice(start, end), "paragraph") };
}

/** Walks up from `from` to the first line of the paragraph, stopping at `runStart` or a structural line. */
function paragraphStart(lines: string[], from: number, runStart: number): number {
	let start = from;
	while (start > runStart) {
		const above = lines[start - 1];
		if (LIST_ITEM.test(above) || ATX.test(above) || QUOTE.test(above) || SETEXT.test(above) || THEMATIC.test(above)) {
			break;
		}
		start--;
	}
	return start;
}

function heading(range: LineRange, lines: string[]): Found {
	return { kind: "heading", label: "heading", range, layout: layoutMarkdown(lines.slice(range.start, range.end), "heading") };
}
