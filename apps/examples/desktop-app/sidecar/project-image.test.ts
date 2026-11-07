import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	PROJECT_IMAGE_LIMIT_BYTES,
	readLocalProjectImage,
} from "./project-image";

const binding = vi.hoisted(() =>
	vi.fn(() => ({ kind: "local", environmentId: "local" })),
);
vi.mock("./context", async (original) => ({
	...(await original<typeof import("./context")>()),
	getRuntimeBinding: binding,
}));
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9s8AAAAASUVORK5CYII=",
	"base64",
);
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "cline-markdown-image-"));
	binding.mockReturnValue({ kind: "local", environmentId: "local" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("preserves image bytes and reports MIME from content", () => {
	const path = join(root, "image.png");
	writeFileSync(path, png);
	expect(readLocalProjectImage(root, path)).toEqual({
		mimeType: "image/png",
		contentBase64: png.toString("base64"),
	});
});
it("rejects outside symlinks, unsupported formats, oversized bytes and huge dimensions", () => {
	const path = join(root, "image");
	writeFileSync(path, "<svg onload='alert(1)' />");
	expect(() => readLocalProjectImage(root, path)).toThrow(/Only PNG and JPEG/);
	writeFileSync(path, Buffer.alloc(PROJECT_IMAGE_LIMIT_BYTES + 1));
	expect(() => readLocalProjectImage(root, path)).toThrow(/5 MB/);
	const huge = Buffer.from(png);
	huge.writeUInt32BE(100000, 16);
	writeFileSync(path, huge);
	expect(() => readLocalProjectImage(root, path)).toThrow(/dimensions/);
	symlinkSync(tmpdir(), join(root, "outside"));
	expect(() => readLocalProjectImage(root, join(root, "outside"))).toThrow(
		/outside/,
	);
});
it("requires trusted connections and refuses remote bytes", async () => {
	const ctx = createSidecarContext(root),
		path = join(root, "a.png");
	writeFileSync(path, png);
	const args = { workspaceRoot: root, path };
	await expect(handleCommand(ctx, "read_project_image", args)).rejects.toThrow(
		/trusted desktop/,
	);
	const options = {
		connection: { send: vi.fn(), data: { canApproveTools: true } },
	};
	await expect(
		handleCommand(ctx, "read_project_image", args, options),
	).resolves.toMatchObject({ mimeType: "image/png" });
	binding.mockReturnValue({ kind: "remote", environmentId: "ssh" });
	await expect(
		handleCommand(ctx, "read_project_image", args, options),
	).rejects.toThrow(/only in local workspaces/);
});
