import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import type { TrackedSession } from "./types";

/**
 * Orders sessions the way the desktop app's sidebar does (see the desktop
 * app's session-activity.ts and agent-sidebar.tsx): top-level chats only,
 * newest activity first, pinned first and scheduled next.
 */

/**
 * When each chat open in the desktop app last had a message or finished a
 * turn. The desktop sidecar writes this file; it only knows these times for
 * chats it has open, and the sidebar only uses them for those chats too.
 */
export function sessionActivityPath(): string {
	return join(resolveClineDataDir(), "session-activity.json");
}

export function readSessionActivity(
	path = sessionActivityPath(),
): Record<string, number> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, number] =>
					typeof entry[1] === "number" && Number.isFinite(entry[1]),
			),
		);
	} catch {
		return {};
	}
}

function isKnown(value: string | undefined): boolean {
	const trimmed = value?.trim().toLowerCase() ?? "";
	return trimmed.length > 0 && trimmed !== "unknown";
}

/** The chats the desktop sidebar lists: no teammates or subagents. */
export function isSidebarSession(session: TrackedSession): boolean {
	return (
		!session.parentSessionId &&
		session.isSubagent !== true &&
		isKnown(session.provider) &&
		isKnown(session.model)
	);
}

/** Latest of last activity, end and start, as the desktop sidebar uses. */
export function sessionActivityTime(
	session: TrackedSession,
	lastActivityAt?: number,
): number {
	return Math.max(
		lastActivityAt ?? Number.NEGATIVE_INFINITY,
		session.endedAt ?? Number.NEGATIVE_INFINITY,
		session.startedAt ?? session.createdAt,
	);
}

export function orderSessionsLikeDesktopSidebar(
	sessions: Iterable<TrackedSession>,
	activity: Record<string, number> = {},
): TrackedSession[] {
	const sorted = [...sessions].filter(isSidebarSession).sort((a, b) => {
		const left = sessionActivityTime(a, activity[a.sessionId]);
		const right = sessionActivityTime(b, activity[b.sessionId]);
		return (
			(left === right ? 0 : right - left) ||
			b.sessionId.localeCompare(a.sessionId)
		);
	});
	return [
		...sorted.filter((session) => session.pinned),
		...sorted.filter((session) => !session.pinned && session.scheduled),
		...sorted.filter((session) => !session.pinned && !session.scheduled),
	];
}

const FINISHED_STATUS =
	/^(completed|failed|cancelled|canceled|aborted|error)$/i;

/**
 * A session event carries fewer details than a full listing; keep the
 * details already known so the order does not jump between refreshes.
 */
export function keepSessionDetails(
	existing: TrackedSession | undefined,
	next: TrackedSession,
): TrackedSession {
	if (!existing) return next;
	return {
		...next,
		startedAt: existing.startedAt ?? next.startedAt,
		isSubagent: existing.isSubagent ?? next.isSubagent,
		endedAt:
			existing.endedAt ??
			(FINISHED_STATUS.test(next.status) ? next.updatedAt : undefined),
	};
}
