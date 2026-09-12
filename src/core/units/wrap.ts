/** Width value meaning the restored lines are never split. */
export const NO_WRAP = 0;

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 100;

const MARKER = /^\s*(?:[-*+]|\d{1,9}[.)]) +/;

/** Returns the indent a continuation of `line` takes. A list item indents to the width of its marker, and any other line to its leading whitespace. */
export function continuationIndent(line: string): string {
	const m = MARKER.exec(line);
	if (m) {
		return " ".repeat(m[0].length);
	}
	return /^\s*/.exec(line)![0];
}

/**
 * Takes the longest leading piece of `line` that fits in `avail` columns, cutting at a
 * word boundary. Returns the remainder, already indented, when a cut was made.
 */
export function takePiece(line: string, avail: number, indent: string): { piece: string; rest?: string } {
	if (avail === Infinity || line.length <= avail || avail <= indent.length + 1) {
		return { piece: line };
	}
	const minCut = indent.length + 1;
	let cut = line.lastIndexOf(" ", avail);
	if (cut < minCut) {
		cut = line.indexOf(" ", avail);
	}
	if (cut < minCut) {
		return { piece: line };
	}
	const rest = line.slice(cut).trim();
	if (rest === "") {
		return { piece: line.trimEnd() };
	}
	return { piece: line.slice(0, cut).trimEnd(), rest: indent + rest };
}

/** Derives the wrap width from the longest original line, clamped to `MIN_WIDTH`..`MAX_WIDTH`. */
export function derivedWidth(lines: string[]): number {
	const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest));
}
