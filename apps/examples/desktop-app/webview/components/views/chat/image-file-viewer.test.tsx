// @vitest-environment jsdom
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readLocalProjectImage } from "../../../../sidecar/project-image";
import { ImageFileViewer, isImageFile } from "./image-file-viewer";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
let root: Root, container: HTMLDivElement, workspace: string;
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9s8AAAAASUVORK5CYII=";
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	workspace = mkdtempSync(join(tmpdir(), "cline-image-view-"));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	invoke.mockReset();
	URL.createObjectURL = vi.fn(() => "blob:fixture");
	URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	rmSync(workspace, { recursive: true, force: true });
});
async function render(
	path = join(workspace, "image.png"),
	environmentId = "local",
) {
	await act(async () =>
		root.render(
			<ImageFileViewer
				path={path}
				workspaceRoot={workspace}
				environmentId={environmentId}
			/>,
		),
	);
}

it("routes raster and unsupported image extensions, never Markdown/PDF/text", () => {
	for (const extension of [
		"PNG",
		"jpg",
		"jpeg",
		"gif",
		"webp",
		"svg",
		"avif",
		"bmp",
		"ico",
		"tiff",
		"heic",
	])
		expect(isImageFile(`image.${extension}`)).toBe(true);
	for (const extension of ["md", "pdf", "txt", "html", "ts"])
		expect(isImageFile(`a.${extension}`)).toBe(false);
});

it("renders binary-safe fixture bytes with loading, fit, decode failure and URL cleanup", async () => {
	const path = join(workspace, "image.png");
	writeFileSync(path, Buffer.from(png, "base64"));
	invoke.mockImplementation(async (_command, args) =>
		readLocalProjectImage(args.workspaceRoot, args.path),
	);
	await render();
	expect(invoke).toHaveBeenCalledWith("read_project_image", {
		path,
		workspaceRoot: workspace,
		environmentId: "local",
	});
	expect(URL.createObjectURL).toHaveBeenCalledWith(
		expect.objectContaining({
			size: Buffer.from(png, "base64").length,
			type: "image/png",
		}),
	);
	expect(container.textContent).toContain("Loading image");
	const image = container.querySelector("img");
	if (!image) throw new Error("Missing image");
	expect(image.src).toBe("blob:fixture");
	expect(image.className).toContain("object-contain");
	await act(async () => image.dispatchEvent(new Event("load")));
	expect(container.querySelector("output")).toBeNull();
	await act(async () => image.dispatchEvent(new Event("error")));
	expect(container.textContent).toContain("Unable to decode image");
	await act(async () => root.render(null));
	expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
});

it("rejects HTML MIME, reports missing/unsupported/remote errors without an image", async () => {
	invoke.mockResolvedValue({
		contentBase64: btoa("<script>alert(1)</script>"),
		mimeType: "text/html",
	});
	await render();
	expect(container.textContent).toContain("Unsupported image format");
	expect(container.querySelector("img,script")).toBeNull();
	for (const error of [
		"File is missing",
		"Only PNG, JPEG, static GIF and static WebP images are supported",
		"Image preview is currently available only in local workspaces",
	]) {
		invoke.mockRejectedValue(new Error(error));
		await render(join(workspace, `${error}.png`), "ssh");
		expect(container.textContent).toContain(error);
	}
	expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("ignores late reads on path/session environment switch and revokes replaced URLs", async () => {
	let finish: (value: { contentBase64: string; mimeType: string }) => void =
		() => {};
	invoke.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render();
	expect(container.textContent).toContain("Loading image");
	invoke.mockResolvedValue({ contentBase64: png, mimeType: "image/png" });
	await render(join(workspace, "b.png"), "other-session");
	await act(async () => finish({ contentBase64: png, mimeType: "image/png" }));
	expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
	await render(join(workspace, "c.png"));
	expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
	expect(container.querySelector("img")?.alt).toBe("c.png");
});
