import { describe, expect, it, vi } from "vitest";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

vi.mock("./deps", () => ({
	providerSettingsManager: {},
	workspaceRoot: "/workspace",
}));

import { syncHubClientsAndSessions } from "./hub";
import { webviewSessionsPayload } from "./session-mapping";
import { readSessionReasonLevel, sendMessage } from "./sessions";
import { HubContext as RealHubContext, SESSION_PAGE_SIZE } from "./state";

function sessionRecords(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		sessionId: `session_${index}`,
		status: "completed",
		// The desktop sidebar, which the Hub list mirrors, hides sessions with no model.
		provider: "anthropic",
		model: "claude",
		updatedAt: 1_000 + index,
	}));
}

function contextWithSessions(total: number) {
	const ctx = new RealHubContext();
	const records = sessionRecords(total);
	const listSessions = vi.fn(async (limit: number) => records.slice(0, limit));
	ctx.uiClient = {
		listClients: vi.fn(async () => []),
		listSessions,
	} as unknown as HubContext["uiClient"];
	return { ctx, listSessions };
}

describe("hub session list paging", () => {
	it("loads more than ten sessions and reports when older ones remain", async () => {
		const { ctx, listSessions } = contextWithSessions(SESSION_PAGE_SIZE + 5);
		await syncHubClientsAndSessions(ctx);
		expect(listSessions).toHaveBeenLastCalledWith(SESSION_PAGE_SIZE, {
			rootOnly: true,
		});
		const first = webviewSessionsPayload(ctx);
		expect(first).toMatchObject({ hasMore: true });
		expect(first.type === "sessions" && first.sessions.length).toBe(
			SESSION_PAGE_SIZE,
		);

		ctx.sessionListLimit += SESSION_PAGE_SIZE;
		await syncHubClientsAndSessions(ctx);
		const second = webviewSessionsPayload(ctx);
		expect(second).toMatchObject({ hasMore: false });
		expect(second.type === "sessions" && second.sessions.length).toBe(
			SESSION_PAGE_SIZE + 5,
		);
	});
});

describe("thinking effort", () => {
	function contextWithCline(metadata: Record<string, unknown> = {}) {
		const ctx = new RealHubContext();
		const cline = {
			updateSessionConnection: vi.fn(async () => {}),
			get: vi.fn(async () => ({ sessionId: "s1", metadata })),
			update: vi.fn(async () => ({ updated: true })),
			send: vi.fn(async () => undefined),
		};
		ctx.cline = cline as unknown as HubContext["cline"];
		const peer = { selectedSessionId: "s1" } as BrowserPeer;
		return { ctx, cline, peer };
	}

	it("applies and saves a level picked for an open session", async () => {
		const { ctx, cline, peer } = contextWithCline({ title: "Kept" });
		await sendMessage(ctx, peer, "hi", { reasonLevel: "xhigh" });
		expect(cline.updateSessionConnection).toHaveBeenCalledWith("s1", {
			thinking: true,
			reasoningEffort: "xhigh",
		});
		expect(cline.update).toHaveBeenCalledWith("s1", {
			metadata: { title: "Kept", reasonLevel: "xhigh" },
		});
		expect(cline.send).toHaveBeenCalledOnce();
	});

	it("turns thinking off", async () => {
		const { ctx, cline, peer } = contextWithCline();
		await sendMessage(ctx, peer, "hi", { reasonLevel: "none" });
		expect(cline.updateSessionConnection).toHaveBeenCalledWith("s1", {
			thinking: false,
		});
	});

	it("leaves the session's level alone when none was picked", async () => {
		const { ctx, cline, peer } = contextWithCline();
		await sendMessage(ctx, peer, "hi", {});
		expect(cline.updateSessionConnection).not.toHaveBeenCalled();
		expect(cline.update).not.toHaveBeenCalled();
	});

	it("reads hub and desktop saved levels", () => {
		expect(readSessionReasonLevel({ reasonLevel: "max" })).toBe("max");
		expect(
			readSessionReasonLevel({
				reasoning: { thinking: true, reasoningEffort: "high" },
			}),
		).toBe("high");
		expect(readSessionReasonLevel({ reasoning: { thinking: false } })).toBe(
			"none",
		);
		expect(readSessionReasonLevel({})).toBeUndefined();
	});
});
