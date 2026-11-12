import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

/**
 * The visible text of the desktop app's terminal tabs, saved so Cline Hub
 * (a separate process) can show them read-only on the phone. One file per
 * tab; the Hub reads the same folder and format.
 */
export type TerminalSnapshot = {
	id: string;
	/** The chat's session id; absent for a chat not yet saved. */
	sessionId?: string;
	label: string;
	cwd: string;
	status: "running" | "exited";
	/** The last lines of the terminal, as plain text. */
	text: string;
	updatedAt: number;
};

const MAX_TEXT_CHARS = 200_000;
const TERMINAL_ID = /^term_[a-z0-9_]+$/;

export function terminalSnapshotDir(): string {
	return join(resolveClineDataDir(), "terminals");
}

function snapshotPath(id: string): string {
	if (!TERMINAL_ID.test(id)) throw new Error(`Invalid terminal id: ${id}`);
	return join(terminalSnapshotDir(), `${id}.json`);
}

function readSnapshot(args: Record<string, unknown> | undefined) {
	const text = typeof args?.text === "string" ? args.text : "";
	const snapshot: TerminalSnapshot = {
		id: String(args?.id ?? ""),
		label: typeof args?.label === "string" ? args.label : "terminal",
		cwd: typeof args?.cwd === "string" ? args.cwd : "",
		status: args?.status === "exited" ? "exited" : "running",
		text: text.length > MAX_TEXT_CHARS ? text.slice(-MAX_TEXT_CHARS) : text,
		updatedAt: Date.now(),
	};
	if (typeof args?.sessionId === "string" && args.sessionId) {
		snapshot.sessionId = args.sessionId;
	}
	return snapshot;
}

export async function publishTerminalSnapshot(
	args: Record<string, unknown> | undefined,
): Promise<void> {
	const snapshot = readSnapshot(args);
	const path = snapshotPath(snapshot.id);
	await mkdir(terminalSnapshotDir(), { recursive: true, mode: 0o700 });
	// Written then renamed, so the Hub never reads a half-written file.
	const temporary = `${path}.tmp`;
	await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
	await rename(temporary, path);
}

export async function removeTerminalSnapshot(id: unknown): Promise<void> {
	await rm(snapshotPath(String(id ?? "")), { force: true });
}

/** Run when the app loads: shells from an earlier run no longer exist. */
export async function clearTerminalSnapshots(): Promise<void> {
	const entries = await readdir(terminalSnapshotDir()).catch(() => []);
	await Promise.all(
		entries
			.filter((name) => name.endsWith(".json") || name.endsWith(".json.tmp"))
			.map((name) => rm(join(terminalSnapshotDir(), name), { force: true })),
	);
}
