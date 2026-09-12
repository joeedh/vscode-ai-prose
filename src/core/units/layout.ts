import type { UnitKind } from "../protocol.js";
import type { CommentSyntax } from "./languages.js";

/**
 * Describes how the original lines of a unit decompose into syntax and prose, so
 * the prose can be shown alone and the syntax reattached on restore.
 */
export interface Layout {
	/** Opener line emitted verbatim before the body, when the opener stands alone. */
	head?: string;
	/** Closer line emitted verbatim after the body, when the closer stands alone. */
	tail?: string;
	/** Syntax before the prose on each body line. */
	prefixes: string[];
	/** Prose of each body line. */
	lines: string[];
	/** Prefix for body lines that did not exist in the original. */
	bodyPrefix: string;
	/** Text appended to the last body line, such as an inline closer. */
	closeSuffix: string;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a line comment prefix, including doc-comment forms such as `///` and `//!`. */
export function linePrefixPattern(marker: string): RegExp {
	const extra = marker === "//" ? "(?:/*!?)" : "";
	return new RegExp(`^(\\s*)${escapeRegExp(marker)}${extra} ?`);
}

/** Splits a body line into its prefix and prose using `pattern`, or leading whitespace alone. */
function splitPrefix(line: string, pattern?: RegExp): [string, string] {
	const m = pattern ? pattern.exec(line) : null;
	if (m) {
		return [m[0], line.slice(m[0].length)];
	}
	const ws = /^\s*/.exec(line)![0];
	return [ws, line.slice(ws.length)];
}

/** Picks the prefix new lines take from the first prose-bearing line, skipping an inline opener when a later line exists. */
function chooseBodyPrefix(prefixes: string[], lines: string[], openerIndex: number, fallback: string): string {
	const candidates: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== "") {
			candidates.push(i);
		}
	}
	if (candidates.length > 1 && candidates[0] === openerIndex) {
		candidates.shift();
	}
	if (candidates.length > 0) {
		return prefixes[candidates[0]];
	}
	if (prefixes.length > 0) {
		return prefixes[0];
	}
	return fallback;
}

export function layoutLineRun(lines: string[], marker: string): Layout {
	const pattern = linePrefixPattern(marker);
	const prefixes: string[] = [];
	const prose: string[] = [];
	for (const line of lines) {
		const [prefix, text] = splitPrefix(line, pattern);
		prefixes.push(prefix);
		prose.push(text);
	}
	return {
		prefixes,
		lines: prose,
		bodyPrefix: chooseBodyPrefix(prefixes, prose, -1, marker + " "),
		closeSuffix: "",
	};
}

/** Finds the opener's extent on a line, absorbing the doc-comment stars of `/**`. */
export function openerEnd(line: string, index: number, open: string): number {
	let end = index + open.length;
	if (open === "/*") {
		while (line[end] === "*" && line[end + 1] !== "/") {
			end++;
		}
	}
	return end;
}

const GUTTER = /^(\s*)\*(?!\/) ?/;

export function layoutBlock(lines: string[], syntax: Required<CommentSyntax>["block"]): Layout {
	const first = lines[0];
	const last = lines[lines.length - 1];
	// The block's opener is the last one on its first line, since any earlier one closed before it
	const openIdx = first.lastIndexOf(syntax.open);
	const openEnd = openerEnd(first, openIdx, syntax.open);
	const closeIdx = lines.length === 1 ? first.indexOf(syntax.close, openEnd) : last.indexOf(syntax.close);

	const layout: Layout = { prefixes: [], lines: [], bodyPrefix: "", closeSuffix: "" };
	const indent = /^\s*/.exec(first)![0];
	// New lines under an inline opener align with the prose after it
	const aligned = (prefix: string): string => indent + " ".repeat(prefix.length - indent.length);

	if (lines.length === 1) {
		const inner = first.slice(openEnd, closeIdx);
		const [lead, text] = inner.startsWith(" ") ? [" ", inner.slice(1)] : ["", inner];
		layout.prefixes.push(first.slice(0, openEnd) + lead);
		layout.lines.push(text.trimEnd());
		layout.closeSuffix = (text.endsWith(" ") && text.trim() !== "" ? " " : "") + last.slice(closeIdx);
		layout.bodyPrefix = aligned(layout.prefixes[0]);
		return layout;
	}

	let bodyStart = 0;
	let bodyEnd = lines.length;
	const afterOpen = first.slice(openEnd);
	if (afterOpen.trim() === "") {
		layout.head = first;
		bodyStart = 1;
	}
	const beforeClose = last.slice(0, closeIdx);
	const closerAlone = beforeClose.trim() === "" || beforeClose.trim() === "*";
	if (closerAlone) {
		layout.tail = last;
		bodyEnd = lines.length - 1;
	}

	const body = lines.slice(bodyStart, bodyEnd);
	const gutterCount = body.filter((l, i) => !(i === 0 && bodyStart === 0) && GUTTER.test(l)).length;
	const gutterLines = body.length - (bodyStart === 0 ? 1 : 0);
	const hasGutter = gutterLines > 0 && gutterCount * 2 >= gutterLines;

	for (let i = 0; i < body.length; i++) {
		let line = body[i];
		let suffix = "";
		if (!closerAlone && i === body.length - 1) {
			const cut = line.lastIndexOf(syntax.close);
			const before = line.slice(0, cut);
			suffix = (before.endsWith(" ") && before.trim() !== "" ? " " : "") + line.slice(cut);
			line = before.trimEnd();
		}
		if (i === 0 && bodyStart === 0) {
			const inner = line.slice(openEnd);
			const [lead, text] = inner.startsWith(" ") ? [" ", inner.slice(1)] : ["", inner];
			layout.prefixes.push(line.slice(0, openEnd) + lead);
			layout.lines.push(text);
		} else {
			const [prefix, text] = splitPrefix(line, hasGutter ? GUTTER : undefined);
			layout.prefixes.push(prefix);
			layout.lines.push(text);
		}
		layout.closeSuffix = suffix;
	}

	const fallback = hasGutter || layout.head !== undefined ? indent + " * " : indent;
	layout.bodyPrefix = chooseBodyPrefix(layout.prefixes, layout.lines, bodyStart === 0 ? 0 : -1, fallback);
	if (bodyStart === 0 && layout.bodyPrefix === layout.prefixes[0]) {
		layout.bodyPrefix = aligned(layout.bodyPrefix);
	}
	return layout;
}

export const ATX = /^( {0,3}#{1,6})(?: +|$)/;
export const QUOTE = /^( {0,3}> ?)/;
export const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?: +|$)/;

export function layoutMarkdown(lines: string[], kind: UnitKind): Layout {
	const layout: Layout = { prefixes: [], lines: [], bodyPrefix: "", closeSuffix: "" };
	switch (kind) {
		case "heading": {
			const m = ATX.exec(lines[0]);
			if (m) {
				layout.prefixes.push(m[0]);
				layout.lines.push(lines[0].slice(m[0].length));
				layout.bodyPrefix = "";
				return layout;
			}
			// A setext heading keeps its underline as the tail
			layout.tail = lines[lines.length - 1];
			for (const line of lines.slice(0, -1)) {
				const [prefix, text] = splitPrefix(line);
				layout.prefixes.push(prefix);
				layout.lines.push(text);
			}
			layout.bodyPrefix = layout.prefixes[0] ?? "";
			return layout;
		}
		case "listItem": {
			// The marker stays in the prose so the model sees the item; only the base indent is syntax
			const indent = /^\s*/.exec(lines[0])![0];
			for (const line of lines) {
				const own = /^\s*/.exec(line)![0];
				const cut = Math.min(indent.length, own.length);
				layout.prefixes.push(line.slice(0, cut));
				layout.lines.push(line.slice(cut));
			}
			layout.bodyPrefix = indent;
			return layout;
		}
		case "blockquote": {
			for (const line of lines) {
				const [prefix, text] = splitPrefix(line, QUOTE);
				layout.prefixes.push(prefix);
				layout.lines.push(text);
			}
			layout.bodyPrefix = chooseBodyPrefix(layout.prefixes, layout.lines, -1, "> ");
			return layout;
		}
		default: {
			for (const line of lines) {
				const [prefix, text] = splitPrefix(line);
				layout.prefixes.push(prefix);
				layout.lines.push(text);
			}
			layout.bodyPrefix = layout.prefixes[0] ?? "";
			return layout;
		}
	}
}
