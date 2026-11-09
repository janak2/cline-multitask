// Folders the file tree can switch to besides the workspace, remembered per
// environment and workspace. They are for browsing only: sessions still run
// in the workspace folder.
const STORAGE_KEY = "cline.code.project-folders.v1";
export const PROJECT_FOLDERS_CHANGED_EVENT = "cline:project-folders-changed";

function storageKey(environmentId: string, workspaceRoot: string): string {
	return `${environmentId}\n${workspaceRoot}`;
}

function readStore(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(
			window.localStorage.getItem(STORAGE_KEY) ?? "{}",
		);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function readProjectFolders(
	environmentId: string,
	workspaceRoot: string,
): string[] {
	const folders = readStore()[storageKey(environmentId, workspaceRoot)];
	return Array.isArray(folders)
		? folders.filter((folder): folder is string => typeof folder === "string")
		: [];
}

export function writeProjectFolders(
	environmentId: string,
	workspaceRoot: string,
	folders: string[],
): void {
	try {
		const store = readStore();
		const key = storageKey(environmentId, workspaceRoot);
		if (folders.length > 0) store[key] = folders;
		else delete store[key];
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
		window.dispatchEvent(new Event(PROJECT_FOLDERS_CHANGED_EVENT));
	} catch {
		// Not remembering the folders is harmless.
	}
}
