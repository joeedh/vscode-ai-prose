export type DiffOp = { type: "equal" | "del" | "add"; text: string };

/** Produces a line diff of `oldLines` against `newLines` from a longest common subsequence. */
export function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
	const n = oldLines.length;
	const m = newLines.length;
	// lcs[i][j] is the subsequence length of oldLines[i..] and newLines[j..]
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] =
				oldLines[i] === newLines[j]
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldLines[i] === newLines[j]) {
			ops.push({ type: "equal", text: oldLines[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			ops.push({ type: "del", text: oldLines[i] });
			i++;
		} else {
			ops.push({ type: "add", text: newLines[j] });
			j++;
		}
	}
	for (; i < n; i++) {
		ops.push({ type: "del", text: oldLines[i] });
	}
	for (; j < m; j++) {
		ops.push({ type: "add", text: newLines[j] });
	}
	return ops;
}
