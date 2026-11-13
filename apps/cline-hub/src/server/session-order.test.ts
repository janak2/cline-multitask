import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trackSession } from "./session-mapping";
import {
	keepSessionDetails,
	orderSessionsLikeDesktopSidebar,
	readSessionActivity,
	withStoredSessionFields,
} from "./session-order";
import type { TrackedSession } from "./types";

function session(
	id: string,
	fields: Record<string, unknown> = {},
): TrackedSession {
	const tracked = trackSession({
		sessionId: id,
		status: "completed",
		provider: "anthropic",
		model: "claude",
		...fields,
	});
	if (!tracked) throw new Error("not tracked");
	return tracked;
}

describe("orderSessionsLikeDesktopSidebar", () => {
	it("orders by latest activity, not by renames, and hides teammates", () => {
		const ordered = orderSessionsLikeDesktopSidebar(
			[
				// Renamed recently, but its last activity is old.
				session("renamed", {
					startedAt: "2026-11-01T00:00:00Z",
					endedAt: "2026-11-02T00:00:00Z",
					updatedAt: "2026-11-12T00:00:00Z",
				}),
				session("finished-later", {
					startedAt: "2026-11-03T00:00:00Z",
					endedAt: "2026-11-05T00:00:00Z",
				}),
				// Still open; its last message is the newest of all.
				session("active", {
					status: "idle",
					startedAt: "2026-10-01T00:00:00Z",
				}),
				session("teammate", {
					startedAt: "2026-11-11T00:00:00Z",
					metadata: { parentSessionId: "active" },
				}),
				session("subagent", {
					startedAt: "2026-11-11T00:00:00Z",
					isSubagent: true,
				}),
				session("no-model", {
					startedAt: "2026-11-11T00:00:00Z",
					model: "unknown",
				}),
			],
			{ active: Date.parse("2026-11-12T12:00:00Z") },
		);
		expect(ordered.map((item) => item.sessionId)).toEqual([
			"active",
			"finished-later",
			"renamed",
		]);
	});

	it("lists pinned chats first, then scheduled, like the sidebar sections", () => {
		const ordered = orderSessionsLikeDesktopSidebar([
			session("newest", { startedAt: "2026-11-10T00:00:00Z" }),
			session("scheduled", {
				startedAt: "2026-11-02T00:00:00Z",
				metadata: { sessionHistoryOrigin: { trigger: "hub-schedule" } },
			}),
			session("pinned", {
				startedAt: "2026-11-01T00:00:00Z",
				metadata: { pinned: true },
			}),
		]);
		expect(ordered.map((item) => item.sessionId)).toEqual([
			"pinned",
			"scheduled",
			"newest",
		]);
	});

	it("keeps known details when a session event carries fewer fields", () => {
		const listed = session("a", {
			status: "running",
			startedAt: "2026-11-01T00:00:00Z",
		});
		const fromEvent = session("a", {
			status: "completed",
			createdAt: Date.parse("2026-11-01T00:00:00Z"),
			updatedAt: Date.parse("2026-11-04T00:00:00Z"),
		});
		const kept = keepSessionDetails(listed, fromEvent);
		expect(kept.startedAt).toBe(Date.parse("2026-11-01T00:00:00Z"));
		expect(kept.endedAt).toBe(Date.parse("2026-11-04T00:00:00Z"));
		expect(kept.status).toBe("completed");
	});
});

describe("withStoredSessionFields", () => {
	it("fills in the saved model and times the Hub list leaves out", () => {
		// What the Hub's session list actually sends: no model or start time.
		const hubRecord = {
			sessionId: "s1",
			status: "idle",
			createdAt: Date.parse("2026-11-01T00:00:00Z"),
			updatedAt: Date.parse("2026-11-12T00:00:00Z"),
			metadata: { title: "A chat" },
		};
		expect(
			orderSessionsLikeDesktopSidebar([
				trackSession(hubRecord) as TrackedSession,
			]),
		).toEqual([]);

		const filled = withStoredSessionFields(hubRecord, (id) =>
			id === "s1"
				? {
						provider: "anthropic",
						model: "claude",
						startedAt: "2026-11-01T00:00:00Z",
						endedAt: "2026-11-03T00:00:00Z",
						isSubagent: false,
					}
				: undefined,
		);
		const tracked = trackSession(filled) as TrackedSession;
		expect(orderSessionsLikeDesktopSidebar([tracked])).toHaveLength(1);
		expect(tracked.endedAt).toBe(Date.parse("2026-11-03T00:00:00Z"));
		expect(tracked.title).toBe("A chat");
		expect(withStoredSessionFields(hubRecord, () => undefined)).toBe(hubRecord);
	});
});

describe("readSessionActivity", () => {
	it("reads numeric times and tolerates a missing or broken file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hub-activity-"));
		try {
			const path = join(dir, "session-activity.json");
			await writeFile(path, JSON.stringify({ a: 5, b: "x", c: null }));
			expect(readSessionActivity(path)).toEqual({ a: 5 });
			await writeFile(path, "{broken");
			expect(readSessionActivity(path)).toEqual({});
			expect(readSessionActivity(join(dir, "missing.json"))).toEqual({});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
