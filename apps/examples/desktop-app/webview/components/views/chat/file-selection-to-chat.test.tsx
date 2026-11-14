// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSelectionToChat } from "./file-selection-to-chat";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	window.getSelection()?.removeAllRanges();
	container.remove();
	vi.unstubAllGlobals();
});
async function show(
	onAddToChat?: (text: string) => void,
	resourceKey = "file-a",
) {
	await act(async () =>
		root.render(
			<FileSelectionToChat resourceKey={resourceKey} onAddToChat={onAddToChat}>
				<p>Selected document text</p>
				<textarea
					aria-label="File contents"
					defaultValue="Editable document text"
				/>
			</FileSelectionToChat>,
		),
	);
	const button = container.querySelector("button");
	if (!button) throw new Error("Missing Add to chat button");
	return button;
}
async function select(node: Node) {
	await act(async () => {
		const range = document.createRange();
		range.selectNodeContents(node);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	});
}
it("adds selected preview text through the current chat callback", async () => {
	const first = vi.fn();
	const current = vi.fn();
	const button = await show(first);
	expect(button.disabled).toBe(true);
	await select(container.querySelector("p") ?? container);
	expect(button.disabled).toBe(false);
	await show(current);
	await act(async () => button.click());
	expect(first).not.toHaveBeenCalled();
	expect(current).toHaveBeenCalledExactlyOnceWith("Selected document text");
});
it("ignores selections outside the preview and resets when switching files", async () => {
	const button = await show(vi.fn());
	await select(container.querySelector("p") ?? container);
	await show(vi.fn(), "file-b");
	expect(button.disabled).toBe(true);
	const outside = document.createElement("p");
	outside.textContent = "Chat text";
	document.body.append(outside);
	await select(outside);
	expect(button.disabled).toBe(true);
	outside.remove();
});
it("supports selected text in the file editor and disables read-only chats", async () => {
	const add = vi.fn();
	const button = await show(add);
	const editor = container.querySelector("textarea");
	if (!editor) throw new Error("Missing editor");
	await act(async () => {
		editor.focus();
		editor.setSelectionRange(0, 8);
		editor.dispatchEvent(new Event("select", { bubbles: true }));
	});
	await act(async () => button.click());
	expect(add).toHaveBeenCalledExactlyOnceWith("Editable");
	await show();
	expect(button.disabled).toBe(true);
});
