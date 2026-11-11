import { describe, expect, it } from "vitest";
import {
	MAX_OPEN_TERMINAL_CHATS,
	parseTerminalPanelsState,
	setTerminalOpenForChat,
} from "./terminal-panel-state";

const legacy = { open: true, height: 340 };

describe("per-chat terminal panel state", () => {
	it("opens the panel only for the chat it was opened in", () => {
		const start = { openChats: [], height: 280 };
		const opened = setTerminalOpenForChat(start, "chat-a", true);
		expect(opened.openChats).toEqual(["chat-a"]);
		expect(opened.openChats.includes("chat-b")).toBe(false);
		const both = setTerminalOpenForChat(opened, "chat-b", true);
		expect(both.openChats).toEqual(["chat-b", "chat-a"]);
		expect(setTerminalOpenForChat(both, "chat-a", false).openChats).toEqual([
			"chat-b",
		]);
	});

	it("keeps the list bounded, dropping the oldest chats", () => {
		let state = { openChats: [] as string[], height: 280 };
		for (let index = 0; index < MAX_OPEN_TERMINAL_CHATS + 5; index++) {
			state = setTerminalOpenForChat(state, `chat-${index}`, true);
		}
		expect(state.openChats).toHaveLength(MAX_OPEN_TERMINAL_CHATS);
		expect(state.openChats[0]).toBe(`chat-${MAX_OPEN_TERMINAL_CHATS + 4}`);
		expect(state.openChats).not.toContain("chat-0");
	});

	it("starts closed in every chat when upgrading from the shared setting", () => {
		expect(parseTerminalPanelsState(null, legacy)).toEqual({
			openChats: [],
			height: 340,
		});
	});

	it("reads saved chats and ignores malformed values", () => {
		expect(
			parseTerminalPanelsState(
				JSON.stringify({ openChats: ["a", 4, "b"], height: 410 }),
				legacy,
			),
		).toEqual({ openChats: ["a", "b"], height: 410 });
		expect(parseTerminalPanelsState("not json", legacy)).toEqual({
			openChats: [],
			height: 340,
		});
	});
});
