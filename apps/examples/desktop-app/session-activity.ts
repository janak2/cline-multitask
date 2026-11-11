export function parseTimestamp(value?: string | number | null): number {
	if (value === undefined || value === null || String(value).trim() === "") {
		return Number.NEGATIVE_INFINITY;
	}
	const trimmed = String(value).trim();
	const epoch = Number(trimmed);
	if (Number.isFinite(epoch)) {
		return /^\d{10}$/.test(trimmed) ? epoch * 1000 : epoch;
	}
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

type Activity = {
	origin?: string;
	lastActivityAt?: string | number;
	endedAt?: string | number | null;
	startedAt?: string | number;
};

export function sessionActivityTimestamp(session: Activity): number {
	if (session.origin === "cloud") {
		return parseTimestamp(session.lastActivityAt ?? session.startedAt);
	}
	// updatedAt includes renames and other metadata writes, not just chat activity.
	return Math.max(
		parseTimestamp(session.lastActivityAt),
		parseTimestamp(session.endedAt),
		parseTimestamp(session.startedAt),
	);
}

export function compareSessionsByActivityDesc(
	a: Activity & { sessionId: string },
	b: Activity & { sessionId: string },
): number {
	const left = sessionActivityTimestamp(a);
	const right = sessionActivityTimestamp(b);
	return (
		(left === right ? 0 : right - left) ||
		b.sessionId.localeCompare(a.sessionId)
	);
}

export function isSessionActivityStream(stream?: string): boolean {
	return stream === "chat_user_message" || stream === "chat_done";
}
