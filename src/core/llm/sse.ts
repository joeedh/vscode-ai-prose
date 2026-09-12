/** Yields the payload of each `data:` event, skipping comment keep-alives. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = "";
	let data: string[] = [];
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line === "") {
					if (data.length > 0) {
						yield data.join("\n");
						data = [];
					}
				} else if (line.startsWith("data:")) {
					data.push(line.slice(5).replace(/^ /, ""));
				}
				newline = buffer.indexOf("\n");
			}
			if (done) {
				break;
			}
		}
		if (data.length > 0) {
			yield data.join("\n");
		}
	} finally {
		reader.releaseLock();
	}
}
