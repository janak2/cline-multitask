export function projectReferenceRoot(
	path: string,
	workspaceRoot: string,
	folders: readonly string[],
	repoRoot?: string | null,
): string {
	return (
		[workspaceRoot, ...folders].find((root) => {
			const base = root.replace(/[\\/]+$/, "");
			return (
				path === base ||
				path.startsWith(`${base}/`) ||
				path.startsWith(`${base}\\`)
			);
		}) ??
		repoRoot ??
		workspaceRoot
	);
}
