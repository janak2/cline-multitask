import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import type { WebviewTerminalSnapshot } from "../webview-protocol";

/**
 * Reads the terminal text the desktop app saves for its terminal tabs (see
 * the desktop sidecar's terminal-snapshots.ts, which writes this folder).
 * Read-only: the phone can look at a shell but never type into it.
 */
export function terminalSnapshotDir(): string {
	return join(resolveClineDataDir(), "terminals");
}

function parseSnapshot(raw: string): WebviewTerminalSnapshot | undefined {
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (typeof value.id !== "string" || typeof value.text !== "string") {
			return undefined;
		}
		return {
			id: value.id,
			sessionId:
				typeof value.sessionId === "string" ? value.sessionId : undefined,
			label: typeof value.label === "string" ? value.label : "terminal",
			cwd: typeof value.cwd === "string" ? value.cwd : "",
			status: value.status === "exited" ? "exited" : "running",
			text: value.text,
			updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
		};
	} catch {
		// Being rewritten or corrupt; skipped until the next save.
		return undefined;
	}
}

/** The saved terminals of one session, oldest first. */
export async function listSessionTerminals(
	sessionId: string,
	dir = terminalSnapshotDir(),
): Promise<WebviewTerminalSnapshot[]> {
	const target = sessionId.trim();
	if (!target) return [];
	const names = await readdir(dir).catch(() => [] as string[]);
	const snapshots = await Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.map(async (name) =>
				parseSnapshot(await readFile(join(dir, name), "utf8").catch(() => "")),
			),
	);
	return snapshots
		.filter(
			(snapshot): snapshot is WebviewTerminalSnapshot =>
				snapshot?.sessionId === target,
		)
		.sort((a, b) => a.id.localeCompare(b.id));
}
