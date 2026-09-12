import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "../protocol.js";
import { detectUnit, MARKDOWN, NO_SYNTAX, NO_WRAP, resolveLanguage, restoreUnit } from "./index.js";

const FIXTURES = path.resolve(__dirname, "../../test/fixtures/units");

interface FixtureCase {
	name: string;
	line: number;
	range?: [number, number];
	kind?: Unit["kind"];
	label?: string;
	text?: string[];
	width?: number;
	error?: string;
}

interface Fixture {
	file: string;
	languageId: string;
	crlf?: boolean;
	cases: FixtureCase[];
}

function loadFixtures(): Array<Fixture & { source: string }> {
	return readdirSync(FIXTURES)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			const fixture = JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8")) as Fixture;
			let source = readFileSync(path.join(FIXTURES, fixture.file), "utf8").replace(/\r\n/g, "\n");
			if (fixture.crlf) {
				source = source.replace(/\n/g, "\r\n");
			}
			return { ...fixture, source };
		});
}

describe("fixtures", () => {
	for (const fixture of loadFixtures()) {
		const eol = fixture.crlf ? "\r\n" : "\n";
		const lang = resolveLanguage(fixture.languageId, fixture.file)!;
		describe(fixture.file, () => {
			for (const c of fixture.cases) {
				it(c.name, () => {
					const result = detectUnit(fixture.source, fixture.languageId, fixture.file, c.line);
					if (c.error !== undefined) {
						expect(result).toEqual({ ok: false, reason: c.error });
						return;
					}
					if (!result.ok) {
						throw new Error(`expected a unit, got: ${result.reason}`);
					}
					const unit = result.unit;
					expect([unit.range.start, unit.range.end]).toEqual(c.range);
					expect(unit.kind).toBe(c.kind);
					expect(unit.label).toBe(c.label);
					expect(unit.text.split("\n")).toEqual(c.text);
					if (c.width !== undefined) {
						expect(unit.width).toBe(c.width);
					}
					const originalLines = fixture.source.split(eol).slice(unit.range.start, unit.range.end);
					expect(unit.original).toBe(originalLines.map((l) => l.replace(/\r$/, "")).join("\n"));
					expect(restoreUnit(unit, unit.text, lang, eol)).toBe(originalLines.join(eol));
				});
			}
		});
	}
});

function unitOf(original: string, kind: Unit["kind"], languageId: string, width: number, text?: string): Unit {
	const filePath = languageId === MARKDOWN ? "x.md" : "x.ts";
	const detected = detectUnit(original, languageId, filePath, 0);
	if (!detected.ok) {
		throw new Error(detected.reason);
	}
	return { ...detected.unit, kind, width, text: text ?? detected.unit.text };
}

describe("restoreUnit", () => {
	const gutter = "/*\n * One.\n * Two.\n */";

	it("grows a gutter block by two lines with the gutter prefix", () => {
		const unit = unitOf(gutter, "block", "typescript", 60);
		expect(restoreUnit(unit, "One.\nTwo.\nThree.\nFour.", "typescript")).toBe("/*\n * One.\n * Two.\n * Three.\n * Four.\n */");
	});

	it("shrinks a gutter block to one line and drops the surplus prefixes", () => {
		const unit = unitOf(gutter, "block", "typescript", 60);
		expect(restoreUnit(unit, "Only.", "typescript")).toBe("/*\n * Only.\n */");
	});

	it("shrinks an inline block to one line and keeps the closer inline", () => {
		const unit = unitOf("/* Opener inline\n   closer inline too */", "block", "typescript", 60);
		expect(restoreUnit(unit, "Short.", "typescript")).toBe("/* Short. */");
	});

	it("grows a line run with the marker prefix", () => {
		const unit = unitOf("  // a\n  // b", "lineRun", "typescript", 60);
		expect(restoreUnit(unit, "a\nb\nc\nd", "typescript")).toBe("  // a\n  // b\n  // c\n  // d");
	});

	it("writes an empty prose line as the bare marker", () => {
		const unit = unitOf("// a", "lineRun", "typescript", 60);
		expect(restoreUnit(unit, "a\n\nb", "typescript")).toBe("// a\n//\n// b");
	});

	it("gives a prose line landing on a bare marker slot the body prefix", () => {
		const unit = unitOf("// a\n//\n// b", "lineRun", "typescript", 60);
		expect(restoreUnit(unit, "a\nb\nc", "typescript")).toBe("// a\n// b\n// c");
	});

	it("splits a long line at a word boundary and indents the continuation to the list marker", () => {
		const unit = unitOf("// - short", "lineRun", "typescript", 40);
		const prose = "- one two three four five six seven eight nine ten eleven";
		expect(restoreUnit(unit, prose, "typescript")).toBe("// - one two three four five six seven\n//   eight nine ten eleven");
	});

	it("indents a plain continuation to the line's leading whitespace", () => {
		const unit = unitOf("//   short", "lineRun", "typescript", 30);
		expect(restoreUnit(unit, "  alpha beta gamma delta epsilon zeta", "typescript")).toBe("//   alpha beta gamma delta\n//   epsilon zeta");
	});

	it("splits a markdown list item and indents the continuation", () => {
		const unit = unitOf("- x", "listItem", MARKDOWN, 30);
		expect(restoreUnit(unit, "- alpha beta gamma delta epsilon zeta", MARKDOWN)).toBe("- alpha beta gamma delta\n  epsilon zeta");
	});

	it("never joins lines", () => {
		const unit = unitOf("// a", "lineRun", "typescript", 80);
		expect(restoreUnit(unit, "a\nb", "typescript")).toBe("// a\n// b");
	});

	it("never splits when the width is NO_WRAP", () => {
		const long = "# " + "word ".repeat(40).trim();
		const unit = unitOf(long, "heading", MARKDOWN, NO_WRAP);
		expect(restoreUnit(unit, unit.text, MARKDOWN)).toBe(long);
	});

	it("keeps a setext underline", () => {
		const unit = unitOf("Title\n=====", "heading", MARKDOWN, NO_WRAP);
		expect(restoreUnit(unit, "New title", MARKDOWN)).toBe("New title\n=====");
	});

	it("keeps the blockquote marker on every line", () => {
		const unit = unitOf("> a", "blockquote", MARKDOWN, 60);
		expect(restoreUnit(unit, "a\n\nb", MARKDOWN)).toBe("> a\n>\n> b");
	});

	it("joins with the requested line ending", () => {
		const unit = unitOf("// a", "lineRun", "typescript", 60);
		expect(restoreUnit(unit, "a\nb", "typescript", "\r\n")).toBe("// a\r\n// b");
	});

	it("reserves room for an inline closer on the last line", () => {
		const unit = unitOf("/* x */", "block", "typescript", 20);
		expect(restoreUnit(unit, "one two three four", "typescript")).toBe("/* one two three\n   four */");
	});
});

describe("detectUnit widths", () => {
	it("derives the width from the longest line, clamped to 60", () => {
		const r = detectUnit("// short", "typescript", "x.ts", 0);
		expect(r.ok && r.unit.width).toBe(60);
	});

	it("clamps the width to 100", () => {
		const r = detectUnit("// " + "x".repeat(150), "typescript", "x.ts", 0);
		expect(r.ok && r.unit.width).toBe(100);
	});

	it("honors a fixed wrap column", () => {
		const r = detectUnit("// short", "typescript", "x.ts", 0, { wrapColumn: 80 });
		expect(r.ok && r.unit.width).toBe(80);
	});
});

describe("resolveLanguage", () => {
	it("prefers the reported id", () => {
		expect(resolveLanguage("typescript", "x.py")).toBe("typescript");
	});

	it("falls back to the extension for plaintext", () => {
		expect(resolveLanguage("plaintext", "x.py")).toBe("python");
		expect(resolveLanguage("plaintext", "notes.markdown")).toBe(MARKDOWN);
	});

	it("knows Makefile and Dockerfile by name", () => {
		expect(resolveLanguage("plaintext", "Makefile")).toBe("makefile");
		expect(resolveLanguage("plaintext", "/app/Dockerfile")).toBe("dockerfile");
	});

	it("fails on an unknown file", () => {
		expect(resolveLanguage("plaintext", "data.bin")).toBeUndefined();
		expect(detectUnit("x", "plaintext", "data.bin", 0)).toEqual({ ok: false, reason: NO_SYNTAX });
	});
});
