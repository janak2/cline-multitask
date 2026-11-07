import { describe, expect, it, vi } from "vitest";

vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core")>()),
	SqliteSessionStore: class {
		get() {
			return { metadata: {} };
		}
	},
}));
vi.mock("../paths", () => ({
	sharedSessionDataDir: () => "/nonexistent-cline-discovery-test",
	readSessionManifest: () => undefined,
}));
vi.mock("./messages", () => ({ readPersistedChatMessages: () => [] }));

import { discoverChatSessions, mergeDiscoveredSessionLists } from "./discovery";

describe("desktop session discovery", () => {
	it("keeps a resumed live chat in the limited page by its activity", () => {
		const row = {
			busy: true,
			status: "running",
			config: {},
			prompt: "Hello",
			messages: [],
		};
		const result = discoverChatSessions(
			{
				liveSessions: new Map([
					["resumed", { ...row, startedAt: 1000, lastActivityAt: 3000 }],
					["idle", { ...row, startedAt: 2000 }],
				]),
			},
			1,
		);
		expect(result).toMatchObject([
			{ sessionId: "resumed", lastActivityAt: "3000", startedAt: "1000" },
		]);
	});
	it("limits by real activity, not metadata update time, with deterministic ties", () => {
		const old = {
			sessionId: "old",
			startedAt: "2026-07-20T10:00:00Z",
			updatedAt: "2026-07-25T10:00:00Z",
		};
		const active = {
			sessionId: "active",
			startedAt: old.startedAt,
			lastActivityAt: "2026-07-24T10:00:00Z",
		};
		const idle = { sessionId: "idle", startedAt: "2026-07-23T10:00:00Z" };
		expect(mergeDiscoveredSessionLists([old, active], [idle], 2)).toMatchObject(
			[active, idle],
		);
	});
	it.each([
		"idle",
		"running",
		"pending",
		"completed",
	])("hides promptless %s sessions with recovery messages", (status) => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"empty",
						{
							busy: status === "running",
							status,
							startedAt: 1,
							config: {},
							messages: [
								{
									role: "user",
									content: "Recovered",
									metadata: { kind: "recovery_notice" },
								},
							],
						},
					],
				]),
			}),
		).toEqual([]);
	});
	it("keeps a first prompt before messages arrive", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"started",
						{
							busy: true,
							status: "running",
							startedAt: 1,
							config: {},
							prompt: "Hello",
							messages: [],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "started", prompt: "Hello" }]);
	});
	it("recovers a prompt from history", () => {
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"history",
						{
							busy: false,
							status: "completed",
							startedAt: 1,
							config: {},
							prompt: " ",
							messages: [{ role: "user", content: "Hello" }],
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "history", prompt: "Hello" }]);
	});
});

// These are the same prompt derivation rules used by restore and fork.
import { derivePromptFromMessages } from "./common";

describe("restored session prompts", () => {
	it.each([
		"recovery_notice",
		"compaction",
		"compaction_summary",
		"completion_reminder",
		"manual_compaction",
	])("ignores %s text", (kind) => {
		const messages = [
			{ role: "user", content: "Synthetic text", metadata: { kind } },
		];
		expect(derivePromptFromMessages(messages)).toBeUndefined();
		expect(
			derivePromptFromMessages([
				...messages,
				{ role: "user", content: "Actual question" },
			]),
		).toBe("Actual question");
	});
	it.each([
		"image",
		"file",
	])("keeps idle attachment-only %s sessions", (type) => {
		const messages = [
			{ role: "user", content: [{ type, data: "attachment" }] },
		];
		expect(
			discoverChatSessions({
				liveSessions: new Map([
					[
						"attachment",
						{
							busy: false,
							status: "idle",
							startedAt: 1,
							config: {},
							prompt: "",
							messages,
						},
					],
				]),
			}),
		).toMatchObject([{ sessionId: "attachment", prompt: `[${type}]` }]);
	});
});
