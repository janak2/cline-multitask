// @vitest-environment jsdom
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileViewStateProvider } from "@/lib/file-view-state";
import { handleCommand } from "../../../../sidecar/commands";
import { createSidecarContext } from "../../../../sidecar/context";
import { MarkdownFileViewer } from "./markdown-file-viewer";

vi.mock("../../../../sidecar/context", async (original) => ({
	...(await original<typeof import("../../../../sidecar/context")>()),
	getRuntimeBinding: () => ({ kind: "local", environmentId: "local" }),
}));

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.open,
}));
vi.mock("@cline/ui/components/markdown", async (original) => ({
	...(await original<typeof import("@cline/ui/components/markdown")>()),
	markdownCodeHighlighter: {
		supportsLanguage: () => false,
		getThemes: () => ["github-light", "github-dark"],
		highlight: () => null,
	},
}));
let container: HTMLDivElement, root: Root;
const onOpenFile = vi.fn();
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	localStorage.clear();
	vi.clearAllMocks();
	URL.createObjectURL = vi.fn(() => "blob:workspace-image");
	URL.revokeObjectURL = vi.fn();
	mocks.invoke.mockImplementation(async (command, args) => {
		if (command === "validate_project_reference") return { path: args.path };
		return { contentBase64: btoa("PNG\0\xff"), mimeType: "image/png" };
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(
	content: string,
	key = "session-a",
	truncated = false,
	workspaceRoot = "/repo",
) {
	await act(async () =>
		root.render(
			<FileViewStateProvider value={key}>
				<MarkdownFileViewer
					content={content}
					path={`${workspaceRoot}/docs/README.md`}
					workspaceRoot={workspaceRoot}
					environmentId="local"
					onOpenFile={onOpenFile}
					truncated={truncated}
				/>
			</FileViewStateProvider>,
		),
	);
}
async function click(text: string) {
	const element = Array.from(container.querySelectorAll("button,a")).find(
		(element) => element.textContent === text,
	);
	if (!element) throw new Error(`Missing ${text}`);
	await act(async () =>
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		),
	);
}
it("defaults to formatted preview, retains source per session and does not read text on toggle", async () => {
	await render(
		"# Title\n\n- [x] Ready\n\n|A|B|\n|--|--|\n|1|2|\n\n```ts\nconst x=1\n```",
	);
	expect(container.querySelector("h1")?.textContent).toBe("Title");
	expect(container.querySelector("table")).not.toBeNull();
	await click("Source");
	expect(
		container.querySelector('[data-testid="file-contents"]'),
	).not.toBeNull();
	await render("# Other", "session-b");
	expect(container.querySelector("h1")?.textContent).toBe("Other");
	await render("# Title", "session-a");
	expect(
		container.querySelector('[data-testid="file-contents"]'),
	).not.toBeNull();
	expect(mocks.invoke).not.toHaveBeenCalled();
});
it("opens relative files without navigation and keeps unsafe HTML inert", async () => {
	await render(
		'[Guide](../guide.md)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src="https://tracker.invalid/a" onerror="alert(1)"/>',
	);
	await click("Guide");
	expect(onOpenFile).toHaveBeenCalledWith("/repo/guide.md");
	expect(container.querySelector("script")).toBeNull();
	expect(container.innerHTML).not.toContain("onerror");
	expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
	expect(mocks.invoke).toHaveBeenCalledWith("validate_project_reference", {
		path: "/repo/guide.md",
		workspaceRoot: "/repo",
		environmentId: "local",
	});
});
it("reads relative images via authorized binary command and releases URLs", async () => {
	await render("![chart](../images/a.png)");
	expect(mocks.invoke).toHaveBeenCalledWith("read_project_image", {
		path: "/repo/images/a.png",
		workspaceRoot: "/repo",
		environmentId: "local",
	});
	expect(container.querySelector("img")?.src).toBe("blob:workspace-image");
	await render("# No image");
	expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workspace-image");
});
it("shows explicit remote and truncated errors", async () => {
	mocks.invoke.mockRejectedValue(
		new Error("Image preview is currently available only in local workspaces"),
	);
	await render("![chart](../a.png)");
	expect(container.textContent).toContain("only in local workspaces");
	await render("# Partial", "session-a", true);
	expect(container.textContent).toContain("Preview unavailable");
	await click("Source");
	expect(
		container.querySelector('[data-testid="file-contents"]'),
	).not.toBeNull();
});

it("does not trust forged reference attributes or load absolute and remote images", async () => {
	await render(
		'<a href="https://example.com" data-document-reference="../secret.md">External</a>\n\n<img src="https://tracker.invalid/a" data-document-reference="../secret.png" />\n\n![absolute](/etc/passwd)',
	);
	expect(mocks.invoke).not.toHaveBeenCalled();
	await click("External");
	expect(mocks.open).toHaveBeenCalledWith("https://example.com");
	expect(onOpenFile).not.toHaveBeenCalled();
});

it("blocks escaping links and keeps middle-click workspace links inside the app", async () => {
	await render("[Escape](../../secret.md)\n\n[Guide](../guide.md)");
	await click("Escape");
	expect(container.textContent).toContain("Link blocked");
	expect(onOpenFile).not.toHaveBeenCalled();
	const guide = Array.from(container.querySelectorAll("a")).find(
		(link) => link.textContent === "Guide",
	);
	await act(async () =>
		guide?.dispatchEvent(
			new MouseEvent("auxclick", {
				button: 1,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
	expect(onOpenFile).toHaveBeenCalledWith("/repo/guide.md");
});

it("assigns heading anchors and scrolls fragments inside the preview", async () => {
	const scroll = vi.fn();
	Element.prototype.scrollIntoView = scroll;
	await render("# Heading\n\n# Heading\n\n[Jump](#heading-1)");
	expect(
		Array.from(container.querySelectorAll("h1")).map((heading) => heading.id),
	).toEqual(["heading", "heading-1"]);
	await click("Jump");
	expect(scroll).toHaveBeenCalled();
	expect(onOpenFile).not.toHaveBeenCalled();
});

it("renders bare and spaced references with real hardening and authorized fixture reads", async () => {
	const fixture = mkdtempSync(join(tmpdir(), "cline-document-"));
	const workspace = join(fixture, "workspace");
	mkdirSync(join(workspace, "docs"), { recursive: true });
	mkdirSync(join(fixture, "workspace-sibling"));
	writeFileSync(join(workspace, "docs", "guide space.md"), "# Guide");
	writeFileSync(join(workspace, "parent.md"), "# Parent");
	writeFileSync(join(fixture, "workspace-sibling", "secret.md"), "secret");
	symlinkSync(join(fixture, "workspace-sibling"), join(workspace, "escape"));
	const png =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9s8AAAAASUVORK5CYII=";
	writeFileSync(
		join(workspace, "docs", "chart space.png"),
		Buffer.from(png, "base64"),
	);
	const ctx = createSidecarContext(workspace);
	mocks.invoke.mockImplementation((command, args) =>
		handleCommand(ctx, command, args, {
			connection: { send: vi.fn(), data: { canApproveTools: true } },
		}),
	);
	try {
		await render(
			"[Bare](<guide space.md>)\n\n[Parent](../parent.md)\n\n![chart](chart%20space.png)\n\n![remote](https://tracker.invalid/x.png)\n\n[Escape](../escape/secret.md)\n\n[Missing](missing.md)",
			"fixture",
			false,
			workspace,
		);
		expect(container.textContent).not.toContain("[blocked]");
		expect(container.textContent).toContain("Remote image not loaded");
		expect(container.querySelector("img")?.src).toBe("blob:workspace-image");
		expect(URL.createObjectURL).toHaveBeenCalledWith(
			expect.objectContaining({
				size: Buffer.from(png, "base64").length,
				type: "image/png",
			}),
		);
		await click("Bare");
		expect(onOpenFile).toHaveBeenLastCalledWith(
			join(workspace, "docs", "guide space.md"),
		);
		await click("Parent");
		expect(onOpenFile).toHaveBeenLastCalledWith(join(workspace, "parent.md"));
		onOpenFile.mockClear();
		await click("Escape");
		expect(container.textContent).toContain("outside the workspace");
		await click("Missing");
		expect(container.textContent).toContain("Linked file is missing");
		expect(onOpenFile).not.toHaveBeenCalled();
		expect(
			container.querySelector(
				'[src*="document.invalid"], [href*="document.invalid"]',
			),
		).toBeNull();
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
