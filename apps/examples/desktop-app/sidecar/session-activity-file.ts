import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * When each chat open in this app last had a message or finished a turn.
 * The sidebar orders chats by this; Cline Hub (a separate process) reads the
 * file so the phone lists chats in the same order. Only chats open in this
 * run are included, matching what the sidebar knows.
 */
export function sessionActivityPath(): string {
	return join(resolveClineDataDir(), "session-activity.json");
}

const WRITE_DELAY_MS = 1_000;
let timer: ReturnType<typeof setTimeout> | undefined;
let latest: Record<string, number> = {};

async function write(snapshot: Record<string, number>): Promise<void> {
	const path = sessionActivityPath();
	await mkdir(dirname(path), { recursive: true });
	// Written then renamed, so the Hub never reads a half-written file.
	const temporary = `${path}.tmp`;
	await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
	await rename(temporary, path);
}

/** Saves the given times, at most once a second. */
export function scheduleSessionActivityWrite(
	snapshot: Record<string, number>,
): void {
	latest = snapshot;
	if (timer) return;
	timer = setTimeout(() => {
		timer = undefined;
		void write(latest).catch(() => {
			// Best effort: the phone just orders by start and end times.
		});
	}, WRITE_DELAY_MS);
}

/** Run when the app starts: times from an earlier run no longer apply. */
export async function clearSessionActivity(): Promise<void> {
	await write({}).catch(() => {});
}

export function liveSessionActivity(
	sessions: Iterable<[string, { lastActivityAt?: number }]>,
): Record<string, number> {
	const snapshot: Record<string, number> = {};
	for (const [sessionId, session] of sessions) {
		if (typeof session.lastActivityAt === "number") {
			snapshot[sessionId] = session.lastActivityAt;
		}
	}
	return snapshot;
}
