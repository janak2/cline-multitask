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
import { validateLocalProjectReference } from "./project-reference";

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

it.each([
	["image/gif", "R0lGODdhAgADAIEAAP8AAAAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7"],
	[
		"image/webp",
		"UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
	],
])("validates static %s by content rather than extension", (mimeType, contentBase64) => {
	const path = join(root, "misleading.png");
	writeFileSync(path, Buffer.from(contentBase64, "base64"));
	expect(readLocalProjectImage(root, path)).toEqual({
		mimeType,
		contentBase64,
	});
});

it("rejects oversized raster dimensions, malformed headers and animated WebP", () => {
	const path = join(root, "image");
	const gif = Buffer.from(
		"R0lGODdhAgADAIEAAP8AAAAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7",
		"base64",
	);
	gif.writeUInt16LE(65535, 6);
	writeFileSync(path, gif);
	expect(() => readLocalProjectImage(root, path)).toThrow(/dimensions/);
	writeFileSync(path, gif.subarray(0, 20));
	expect(() => readLocalProjectImage(root, path)).toThrow(/Invalid GIF/);
	const webp = Buffer.alloc(30);
	webp.write("RIFF");
	webp.writeUInt32LE(22, 4);
	webp.write("WEBPVP8X", 8);
	webp.writeUInt32LE(10, 16);
	webp[20] = 2;
	writeFileSync(path, webp);
	expect(() => readLocalProjectImage(root, path)).toThrow(/Animated WebP/);
	webp[20] = 0;
	webp.writeUIntLE(100000, 24, 3);
	writeFileSync(path, webp);
	expect(() => readLocalProjectImage(root, path)).toThrow(/dimensions/);
	webp.writeUInt32LE(100, 4);
	writeFileSync(path, webp);
	expect(() => readLocalProjectImage(root, path)).toThrow(/Invalid WebP/);
});

it("rejects a second GIF frame and checks JPEG content dimensions", () => {
	const path = join(root, "image");
	const gif = Buffer.from(
		"R0lGODdhAgADAIEAAP8AAAAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7",
		"base64",
	);
	const frame = gif.subarray(gif.indexOf(0x2c), gif.length - 1);
	writeFileSync(
		path,
		Buffer.concat([gif.subarray(0, -1), frame, Buffer.from([0x3b])]),
	);
	expect(() => readLocalProjectImage(root, path)).toThrow(/Animated GIF/);
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 3, 0, 2, 3]);
	writeFileSync(path, jpeg);
	expect(readLocalProjectImage(root, path).mimeType).toBe("image/jpeg");
	jpeg.writeUInt16BE(10000, 7);
	writeFileSync(path, jpeg);
	expect(() => readLocalProjectImage(root, path)).toThrow(/dimensions/);
});
it("rejects outside symlinks, unsupported formats, oversized bytes and huge dimensions", () => {
	const path = join(root, "image");
	writeFileSync(path, "<svg onload='alert(1)' />");
	expect(() => readLocalProjectImage(root, path)).toThrow(/Only PNG, JPEG/);
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

it("validates linked files through the trusted command and rejects missing, directory and symlink targets", async () => {
	const ctx = createSidecarContext(root);
	const path = join(root, "guide space.md");
	writeFileSync(path, "# Guide");
	const args = { workspaceRoot: root, path };
	const options = {
		connection: { send: vi.fn(), data: { canApproveTools: true } },
	};
	await expect(
		handleCommand(ctx, "validate_project_reference", args),
	).rejects.toThrow(/trusted desktop/);
	await expect(
		handleCommand(ctx, "validate_project_reference", args, options),
	).resolves.toEqual({ path });
	expect(() =>
		validateLocalProjectReference(root, join(root, "missing")),
	).toThrow(/missing/);
	expect(() => validateLocalProjectReference(root, root)).toThrow(/not a file/);
	symlinkSync(tmpdir(), join(root, "escape"));
	expect(() =>
		validateLocalProjectReference(root, join(root, "escape")),
	).toThrow(/outside the workspace/);
	symlinkSync(path, join(root, "safe.md"));
	expect(validateLocalProjectReference(root, join(root, "safe.md"))).toBe(path);
	binding.mockReturnValue({ kind: "remote", environmentId: "ssh" });
	await expect(
		handleCommand(ctx, "validate_project_reference", args, options),
	).rejects.toThrow(/only in local workspaces/);
});
