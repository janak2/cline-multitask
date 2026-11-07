// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileViewStateProvider } from "@/lib/file-view-state";
import { MarkdownFileViewer } from "./markdown-file-viewer";

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
	mocks.invoke.mockResolvedValue({
		contentBase64: btoa("PNG\0\xff"),
		mimeType: "image/png",
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(content: string, key = "session-a", truncated = false) {
	await act(async () =>
		root.render(
			<FileViewStateProvider value={key}>
				<MarkdownFileViewer
					content={content}
					path="/repo/docs/README.md"
					workspaceRoot="/repo"
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
	expect(mocks.invoke).not.toHaveBeenCalled();
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
