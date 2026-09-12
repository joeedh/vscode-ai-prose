import type { Unit } from "../protocol.js";
import { layoutBlock, layoutLineRun, layoutMarkdown, type Layout } from "./layout.js";
import { MARKDOWN, syntaxFor } from "./languages.js";
import { continuationIndent, NO_WRAP, takePiece } from "./wrap.js";

/** Recomputes the layout of a unit from its original lines. */
export function layoutOf(unit: Unit, languageId: string): Layout {
	const lines = unit.original.split("\n");
	if (languageId === MARKDOWN) {
		return layoutMarkdown(lines, unit.kind);
	}
	const syntax = syntaxFor(languageId);
	if (unit.kind === "block" && syntax?.block) {
		return layoutBlock(lines, syntax.block);
	}
	return layoutLineRun(lines, syntax?.line ?? "");
}

function prefixAt(layout: Layout, slot: number, hasProse: boolean): string {
	const own = slot < layout.prefixes.length ? layout.prefixes[slot] : layout.bodyPrefix;
	if (!hasProse) {
		return own.trimEnd();
	}
	// A slot from an empty line carries no separating space, so a prose line takes the body prefix
	if (own !== "" && !/\s$/.test(own)) {
		return layout.bodyPrefix;
	}
	return own;
}

/**
 * Reattaches the unit's syntax around `prose` and returns the replacement lines
 * joined by `eol`. Every line break in `prose` is kept; lines longer than the
 * unit's width are split at word boundaries, with continuations indented to the
 * line's list marker or leading whitespace.
 */
export function restoreUnit(unit: Unit, prose: string, languageId: string, eol = "\n"): string {
	const layout = layoutOf(unit, languageId);
	const proseLines = prose.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
	const out: string[] = [];
	if (layout.head !== undefined) {
		out.push(layout.head);
	}
	let slot = 0;
	for (let i = 0; i < proseLines.length; i++) {
		const isLast = i === proseLines.length - 1;
		const indent = continuationIndent(proseLines[i]);
		let cur: string | undefined = proseLines[i];
		while (cur !== undefined) {
			const prefix = prefixAt(layout, slot, cur.trim() !== "");
			const reserve = isLast ? layout.closeSuffix.length : 0;
			const avail = unit.width === NO_WRAP ? Infinity : unit.width - prefix.length - reserve;
			const { piece, rest }: { piece: string; rest?: string } = takePiece(cur, avail, indent);
			out.push(prefix + piece);
			slot++;
			cur = rest;
		}
	}
	if (layout.closeSuffix !== "") {
		out[out.length - 1] += layout.closeSuffix;
	}
	if (layout.tail !== undefined) {
		out.push(layout.tail);
	}
	return out.join(eol);
}
