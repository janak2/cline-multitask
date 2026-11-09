// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileViewStateProvider } from "@/lib/file-view-state";
import { TextFileEditor } from "./text-file-editor";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
let container: HTMLDivElement;
let root: Root;
const saved = vi.fn();
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	localStorage.clear();
	vi.clearAllMocks();
	invoke.mockResolvedValue({ content: "original", truncated: false });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(path = "/repo/notes.txt", content = "original") {
	await act(async () =>
		root.render(
			<FileViewStateProvider value="editor-test">
				<TextFileEditor
					key={path}
					path={path}
					content={content}
					environmentId="local"
					workspaceRoot="/repo"
					onSaved={saved}
				>
					<div>File preview</div>
				</TextFileEditor>
			</FileViewStateProvider>,
		),
	);
}
async function click(label: string) {
	const button = Array.from(container.querySelectorAll("button")).find(
		(item) => item.textContent === label,
	);
	expect(button).toBeDefined();
	await act(async () => button?.click());
}
async function edit(text: string) {
	await click("Edit");
	await act(async () => {
		const input = container.querySelector("textarea");
		expect(input).not.toBeNull();
		if (!input) return;
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(input, text);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
it.each([
	"/repo/notes.txt",
	"/repo/README.md",
	"/repo/script.py",
	"/repo/app.ts",
	"/repo/config.json",
	"/repo/Makefile",
])("saves UTF-8 edits for %s", async (path) => {
	await render(path);
	await edit("Updated café 📝\r\n");
	await click("Save");
	expect(invoke).toHaveBeenCalledWith("write_project_file", {
		environmentId: "local",
		workspaceRoot: "/repo",
		path,
		contentBase64: Buffer.from("Updated café 📝\n").toString("base64"),
		overwrite: true,
	});
	expect(saved).toHaveBeenCalledOnce();
	expect(container.querySelector("textarea")).toBeNull();
});
it("cancels without writing", async () => {
	await render();
	await edit("discard");
	await click("Cancel");
	expect(invoke).not.toHaveBeenCalled();
	expect(container.textContent).toContain("File preview");
});

it("preserves Windows line endings", async () => {
	await render("/repo/notes.txt", "original\r\n");
	invoke.mockResolvedValue({ content: "original\r\n", truncated: false });
	await edit("updated\nsecond line\n");
	await click("Save");
	expect(invoke).toHaveBeenCalledWith(
		"write_project_file",
		expect.objectContaining({
			contentBase64: Buffer.from("updated\r\nsecond line\r\n").toString(
				"base64",
			),
		}),
	);
});
it("keeps drafts separate across files and restores them after remount", async () => {
	await render();
	await edit("unsaved");
	await render("/repo/other.md");
	expect(container.querySelector("textarea")).toBeNull();
	await act(async () => root.unmount());
	root = createRoot(container);
	await render();
	expect(container.querySelector("textarea")?.value).toBe("unsaved");
});
it.each([
	"changed",
	"truncated",
	"write failure",
])("keeps edits on %s", async (failure) => {
	await render();
	await edit("keep this");
	if (failure === "write failure")
		invoke.mockImplementation(async (command) => {
			if (command === "write_project_file")
				throw new Error("Permission denied");
			return { content: "original", truncated: false };
		});
	else
		invoke.mockResolvedValue({
			content: failure === "changed" ? "other edits" : "original",
			truncated: failure === "truncated",
		});
	await click("Save");
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		failure === "write failure" ? "Permission denied" : "changed on disk",
	);
	expect(container.querySelector("textarea")?.value).toBe("keep this");
	expect(saved).not.toHaveBeenCalled();
	if (failure !== "write failure")
		expect(
			invoke.mock.calls.some(([command]) => command === "write_project_file"),
		).toBe(false);
});
it("saves with Ctrl+S", async () => {
	await render();
	await edit("shortcut");
	await act(async () =>
		container.querySelector("textarea")?.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "s",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
	expect(saved).toHaveBeenCalledOnce();
});
