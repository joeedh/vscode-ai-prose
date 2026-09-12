import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import type { LineRange } from "../core/protocol";
import type { ElectronBridge, FileState } from "../electron/bridge";
import { App } from "./app";
import type { Transport } from "./transport";

/** The Electron window: a read-only file pane beside the panel. */
export function Shell({ bridge }: { bridge: ElectronBridge }) {
	const [file, setFile] = useState<FileState | null>(null);
	const [unit, setUnit] = useState<LineRange | null>(null);
	const transport = useMemo<Transport>(() => ({ post: (msg) => bridge.post(msg), onMessage: (cb) => bridge.onMessage(cb) }), [bridge]);
	useLayoutEffect(() => {
		bridge.onFile(setFile);
		bridge.onMessage((msg) => {
			if (msg.type === "galley") {
				setUnit(msg.unit?.range ?? null);
			}
		});
	}, [bridge]);
	return (
		<div class="shell">
			<FilePane file={file} unit={unit} onLine={(line) => bridge.setCursor(line)} />
			<App transport={transport} />
		</div>
	);
}

export function FilePane({ file, unit, onLine }: { file: FileState | null; unit: LineRange | null; onLine: (line: number) => void }) {
	if (!file) {
		return (
			<aside class="file" aria-label="File">
				<div class="file-title">No file open</div>
				<div class="file-body">
					<p class="file-hint">Open a file with File › Open.</p>
				</div>
			</aside>
		);
	}
	const lines = file.text.split(/\r?\n/);
	return (
		<aside class="file" aria-label="File">
			<div class="file-title">{file.path}</div>
			<div class="file-body">
				{lines.map((line, i) => {
					const inUnit = unit !== null && i >= unit.start && i < unit.end;
					const classes = ["ln", inUnit ? "unit" : "", i === file.cursorLine ? "cursor" : ""].filter(Boolean).join(" ");
					return (
						<div key={i} class={classes} onClick={() => onLine(i)}>
							<span class="n">{i + 1}</span>
							<span class="c">{line}</span>
						</div>
					);
				})}
			</div>
		</aside>
	);
}
