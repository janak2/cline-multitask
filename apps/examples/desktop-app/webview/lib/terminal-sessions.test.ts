// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("@xterm/xterm", () => ({
	Terminal: class {
		options: Record<string, unknown> = {};
		attachCustomKeyEventHandler() {}
		loadAddon() {}
		onData() {}
		onResize() {}
		dispose() {}
	},
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));

const {
	activeTerminalTabId,
	createTerminalTab,
	killTerminalTab,
	listTerminalTabs,
	renameTerminalChat,
	terminalGroupKey,
} = await import("./terminal-sessions");

describe("terminal tabs per chat", () => {
	it("keeps one chat's shells out of another chat in the same folder", async () => {
		const chatA = terminalGroupKey("chat-a", "/repo");
		const chatB = terminalGroupKey("chat-b", "/repo/");
		const tab = createTerminalTab(chatA, "/repo");
		expect(tab.cwd).toBe("/repo");
		expect(listTerminalTabs(chatA)).toEqual([tab]);
		expect(listTerminalTabs(chatB)).toEqual([]);
		expect(activeTerminalTabId(chatB)).toBeNull();

		const other = createTerminalTab(chatB, "/repo");
		expect(listTerminalTabs(chatA)).toEqual([tab]);
		expect(listTerminalTabs(chatB)).toEqual([other]);

		await killTerminalTab(tab);
		expect(listTerminalTabs(chatA)).toEqual([]);
		expect(listTerminalTabs(chatB)).toEqual([other]);
		await killTerminalTab(other);
	});

	it("moves a new chat's shells to its saved session key", async () => {
		const tab = createTerminalTab(
			terminalGroupKey("thread:new", "/repo"),
			"/repo",
		);
		renameTerminalChat("thread:new", "session-1");
		expect(listTerminalTabs(terminalGroupKey("thread:new", "/repo"))).toEqual(
			[],
		);
		expect(listTerminalTabs(terminalGroupKey("session-1", "/repo"))).toEqual([
			tab,
		]);
		expect(activeTerminalTabId(terminalGroupKey("session-1", "/repo"))).toBe(
			tab.id,
		);
		await killTerminalTab(tab);
		expect(listTerminalTabs(terminalGroupKey("session-1", "/repo"))).toEqual(
			[],
		);
	});
});
