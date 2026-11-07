import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import { readLocalProjectPdf } from "./project-files";

const binding = vi.hoisted(() =>
	vi.fn(() => ({ kind: "local", environmentId: "local" })),
);
vi.mock("./context", async (importOriginal) => ({
	...(await importOriginal<typeof import("./context")>()),
	getRuntimeBinding: binding,
}));
afterEach(() =>
	binding.mockReturnValue({ kind: "local", environmentId: "local" }),
);

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
const path = fileURLToPath(new URL("./fixtures/preview.pdf", import.meta.url));

describe("project PDF integration", () => {
	it("requires a trusted desktop connection", async () => {
		await expect(
			handleCommand(createSidecarContext(root), "read_project_pdf", {
				workspaceRoot: root,
				path,
			}),
		).rejects.toThrow(/trusted desktop connection/);
	});

	it("returns bytes only to a trusted local connection and rejects remote reads", async () => {
		const ctx = createSidecarContext(root);
		const options = {
			connection: { send: vi.fn(), data: { canApproveTools: true } },
		};
		await expect(
			handleCommand(
				ctx,
				"read_project_pdf",
				{ workspaceRoot: root, path },
				options,
			),
		).resolves.toMatchObject({
			contentBase64: readFileSync(path).toString("base64"),
		});
		binding.mockReturnValue({ kind: "remote", environmentId: "ssh" });
		await expect(
			handleCommand(
				ctx,
				"read_project_pdf",
				{ workspaceRoot: root, path },
				options,
			),
		).rejects.toThrow(/only in local workspaces/);
	});

	it("renders the real fixture from the binary read response", async () => {
		const require = createRequire(import.meta.url);
		const pdfRoot = createRequire(require.resolve("pdfjs-dist/package.json"));
		const { createCanvas } = pdfRoot("@napi-rs/canvas");
		const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const response = readLocalProjectPdf(root, path);
		expect(Buffer.from(response.contentBase64, "base64")).toEqual(
			readFileSync(path),
		);
		const loading = pdfjs.getDocument({
			data: new Uint8Array(Buffer.from(response.contentBase64, "base64")),
			standardFontDataUrl: join(
				dirname(require.resolve("pdfjs-dist/package.json")),
				"standard_fonts/",
			),
		});
		try {
			const document = await loading.promise;
			expect(document.numPages).toBe(2);
			for (const number of [1, 2]) {
				const page = await document.getPage(number);
				const viewport = page.getViewport({ scale: 1 });
				const canvas = createCanvas(viewport.width, viewport.height);
				await page.render({ canvas, viewport }).promise;
				const pixels: Uint8ClampedArray = canvas
					.getContext("2d")
					.getImageData(0, 0, canvas.width, canvas.height).data;
				expect(
					pixels.some((value, index) => index % 4 !== 3 && value < 100),
				).toBe(true);
				page.cleanup();
			}
		} finally {
			await loading.destroy();
		}
	});
});
