// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatSelectionToChat } from "./chat-selection-to-chat";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(120, 140, 100, 20),
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	window.getSelection()?.removeAllRanges();
	container.remove();
	vi.restoreAllMocks();
	Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
	vi.unstubAllGlobals();
});

const popup = () =>
	[...document.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Add to chat"),
	);

async function select(node: Node | null) {
	if (!node) throw new Error("Missing selection target");
	await act(async () => {
		const range = document.createRange();
		range.selectNodeContents(node);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	});
}

async function show(callback?: (text: string) => void, session = "one") {
	await act(async () =>
		root.render(
			<ChatSelectionToChat key={session} onAddToChat={callback}>
				<p>Previous message text</p>
				<textarea defaultValue="Draft" />
			</ChatSelectionToChat>,
		),
	);
}

it("shows a popup for selected message text and appends it to the current draft", async () => {
	function Composer() {
		const [draft, setDraft] = useState("My current message");
		return (
			<>
				<ChatSelectionToChat
					onAddToChat={(text) =>
						setDraft((previous) => `${previous}\n\n${text}`)
					}
				>
					<p>Previous message text</p>
				</ChatSelectionToChat>
				<textarea aria-label="Current message" value={draft} readOnly />
			</>
		);
	}
	await act(async () => root.render(<Composer />));
	expect(popup()).toBeUndefined();
	await select(container.querySelector("p"));
	expect(popup()?.style.left).toBe("120px");
	expect(popup()?.style.top).toBe("168px");
	await act(async () => popup()?.click());
	expect(container.querySelector("textarea")?.value).toBe(
		"My current message\n\nPrevious message text",
	);
	expect(popup()).toBeUndefined();
});

it("ignores selection outside messages and within editable fields", async () => {
	await show(vi.fn());
	const outside = document.createElement("p");
	outside.textContent = "Not in chat";
	document.body.append(outside);
	try {
		await select(outside);
		expect(popup()).toBeUndefined();
		await select(container.querySelector("textarea"));
		expect(popup()).toBeUndefined();
	} finally {
		outside.remove();
	}
});

it("hides when selection clears, Escape is pressed, the view scrolls, or the chat changes", async () => {
	await show(vi.fn());
	const paragraph = container.querySelector("p");
	await select(paragraph);
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
	});
	expect(popup()).toBeUndefined();
	await select(paragraph);
	await act(async () => window.dispatchEvent(new Event("scroll")));
	expect(popup()).toBeUndefined();
	await select(paragraph);
	await act(async () => {
		window.getSelection()?.removeAllRanges();
		document.dispatchEvent(new Event("selectionchange"));
	});
	expect(popup()).toBeUndefined();
	await select(paragraph);
	await show(vi.fn(), "two");
	expect(popup()).toBeUndefined();
});

it("uses the latest draft callback and does not offer an unavailable composer", async () => {
	const old = vi.fn();
	const current = vi.fn();
	await show(old);
	await select(container.querySelector("p"));
	await show(current);
	await act(async () => popup()?.click());
	expect(current).toHaveBeenCalledWith("Previous message text");
	expect(old).not.toHaveBeenCalled();
	await show();
	await select(container.querySelector("p"));
	expect(popup()).toBeUndefined();
});
