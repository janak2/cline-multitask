// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./terminal-panel";

const terminal = vi.hoisted(() => ({
	selection: "",
	onSelection: null as (() => void) | null,
	dispose: vi.fn(),
	tabs: [] as unknown[],
}));

vi.mock("@/lib/terminal-sessions", () => ({
	terminalGroupKey: (chatKey: string, cwd: string) => `${chatKey}|${cwd}`,
	subscribeTerminalTabs: () => () => {},
	listTerminalTabs: () => terminal.tabs,
	activeTerminalTabId: () => "terminal-1",
	applyTerminalTheme: vi.fn(),
	createTerminalTab: vi.fn(),
	killTerminalTab: vi.fn(),
	setActiveTerminalTab: vi.fn(),
	spawnTerminalTab: vi.fn(),
}));

describe("terminal selection to chat", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		terminal.selection = "";
		terminal.dispose.mockClear();
		terminal.tabs = [
			{
				id: "terminal-1",
				label: "Shell",
				element: document.createElement("div"),
				opened: true,
				fit: { fit: vi.fn() },
				term: {
					getSelection: () => terminal.selection,
					onSelectionChange: (listener: () => void) => {
						terminal.onSelection = listener;
						return { dispose: terminal.dispose };
					},
					focus: vi.fn(),
					refresh: vi.fn(),
					rows: 24,
				},
			},
		];
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	async function render(onAddToChat?: (text: string) => void) {
		await act(async () =>
			root.render(
				<TerminalPanel
					chatKey="chat-a"
					cwd="/workspace"
					onClose={() => {}}
					onAddToChat={onAddToChat}
				/>,
			),
		);
		return Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Add to chat"),
		)!;
	}

	it("fills the resizable right-hand file-view column without a bottom drawer", async () => {
		await render();
		const frame = container.querySelector("#terminal-panel");
		expect(frame?.className).toContain("col-start-2");
		expect(frame?.className).toContain("row-span-2");
		const panel = container.querySelector('[aria-label="Terminal"]');
		expect(panel?.className).toContain("flex-1");
		expect(panel?.getAttribute("style")).toBeNull();
		expect(
			container.querySelector('[aria-label="Resize terminal"]'),
		).toBeNull();
	});

	async function select(text: string) {
		await act(async () => {
			terminal.selection = text;
			terminal.onSelection?.();
		});
	}

	it("adds only selected text on click, using the current chat callback", async () => {
		const firstChat = vi.fn();
		const currentChat = vi.fn();
		const button = await render(firstChat);
		expect(button.disabled).toBe(true);
		await select("error: build failed\n  line 42");
		expect(button.disabled).toBe(false);
		expect(firstChat).not.toHaveBeenCalled();
		await render(currentChat);
		await act(async () => button.click());
		expect(firstChat).not.toHaveBeenCalled();
		expect(currentChat).toHaveBeenCalledExactlyOnceWith(
			"error: build failed\n  line 42",
		);
		await select("");
		expect(button.disabled).toBe(true);
	});

	it("disables the action for whitespace or a chat that cannot accept text", async () => {
		const button = await render(vi.fn());
		await select(" \n ");
		expect(button.disabled).toBe(true);
		await select("output");
		await render();
		expect(button.disabled).toBe(true);
	});

	it("removes the terminal selection listener on unmount", async () => {
		await render(vi.fn());
		await act(async () => root.render(null));
		expect(terminal.dispose).toHaveBeenCalledOnce();
	});
});
