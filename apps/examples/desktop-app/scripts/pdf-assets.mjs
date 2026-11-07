import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function preparePdfAssets() {
	const require = createRequire(import.meta.url);
	const source = path.dirname(require.resolve("pdfjs-dist/package.json"));
	const { version } = require("pdfjs-dist/package.json");
	const target = fileURLToPath(
		new URL(`../webview/public/pdfjs/${version}/`, import.meta.url),
	);
	mkdirSync(target, { recursive: true });
	cpSync(
		path.join(source, "legacy/build/pdf.worker.min.mjs"),
		path.join(target, "pdf.worker.min.mjs"),
	);
	for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
		cpSync(path.join(source, directory), path.join(target, directory), {
			recursive: true,
		});
	}
	cpSync(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
}
