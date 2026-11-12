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
	terminalGroupSessionId,
	terminalText,
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

describe("terminal text shared with Cline Hub", () => {
	it("links a terminal to its chat's saved session id", () => {
		expect(
			terminalGroupSessionId(
				terminalGroupKey(JSON.stringify(["local", "session_1"]), "/repo"),
			),
		).toBe("session_1");
		expect(
			terminalGroupSessionId(terminalGroupKey("thread:new", "/repo")),
		).toBeUndefined();
	});

	it("joins wrapped rows and drops trailing blank lines", () => {
		const rows = [
			{ text: "$ echo long", isWrapped: false },
			{ text: "aaaa", isWrapped: false },
			{ text: "bbbb", isWrapped: true },
			{ text: "", isWrapped: false },
		];
		const term = {
			buffer: {
				active: {
					length: rows.length,
					getLine: (i: number) => ({
						isWrapped: rows[i].isWrapped,
						translateToString: () => rows[i].text,
					}),
				},
			},
		} as unknown as Parameters<typeof terminalText>[0];
		expect(terminalText(term)).toBe("$ echo long\naaaabbbb");
	});
});
