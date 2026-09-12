import * as path from "node:path";

export interface BlockSyntax {
	open: string;
	close: string;
}

export interface CommentSyntax {
	line?: string;
	block?: BlockSyntax;
}

export const MARKDOWN = "markdown";

const C_STYLE: CommentSyntax = { line: "//", block: { open: "/*", close: "*/" } };
const HASH: CommentSyntax = { line: "#" };
const DASH: CommentSyntax = { line: "--" };

/** Comment syntax keyed by the canonical language id. */
const syntaxById: Record<string, CommentSyntax> = {
	typescript: C_STYLE,
	typescriptreact: C_STYLE,
	javascript: C_STYLE,
	javascriptreact: C_STYLE,
	c: C_STYLE,
	cpp: C_STYLE,
	csharp: C_STYLE,
	java: C_STYLE,
	go: C_STYLE,
	rust: C_STYLE,
	swift: C_STYLE,
	kotlin: C_STYLE,
	scala: C_STYLE,
	php: C_STYLE,
	css: { block: { open: "/*", close: "*/" } },
	scss: { block: { open: "/*", close: "*/" } },
	less: { block: { open: "/*", close: "*/" } },
	python: HASH,
	ruby: HASH,
	shellscript: HASH,
	yaml: HASH,
	toml: HASH,
	perl: HASH,
	r: HASH,
	makefile: HASH,
	dockerfile: HASH,
	powershell: { line: "#", block: { open: "<#", close: "#>" } },
	lua: { line: "--", block: { open: "--[[", close: "]]" } },
	haskell: { line: "--", block: { open: "{-", close: "-}" } },
	sql: DASH,
	[MARKDOWN]: {},
};

/** Aliases VS Code or a file extension may report, mapped to a canonical id. */
const aliases: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescriptreact",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascriptreact",
	h: "c",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hh: "cpp",
	cs: "csharp",
	rs: "rust",
	kt: "kotlin",
	kts: "kotlin",
	py: "python",
	pyi: "python",
	rb: "ruby",
	sh: "shellscript",
	bash: "shellscript",
	zsh: "shellscript",
	yml: "yaml",
	pl: "perl",
	pm: "perl",
	mk: "makefile",
	ps1: "powershell",
	psm1: "powershell",
	psd1: "powershell",
	hs: "haskell",
	md: MARKDOWN,
	markdown: MARKDOWN,
};

/** Files whose name alone fixes the language. */
const byBasename: Record<string, string> = {
	makefile: "makefile",
	dockerfile: "dockerfile",
};

function canonical(id: string): string | undefined {
	const key = id.toLowerCase();
	if (key in syntaxById) {
		return key;
	}
	return aliases[key];
}

/**
 * Resolves the canonical language id from the id the editor reports or, failing that,
 * from the file name. Returns undefined when no comment syntax is known.
 */
export function resolveLanguage(languageId: string, filePath: string): string | undefined {
	const fromId = canonical(languageId);
	if (fromId) {
		return fromId;
	}
	const base = path.basename(filePath).toLowerCase();
	if (base in byBasename) {
		return byBasename[base];
	}
	const ext = path.extname(base).slice(1);
	return ext ? canonical(ext) : undefined;
}

export function syntaxFor(languageId: string): CommentSyntax | undefined {
	return syntaxById[languageId];
}
