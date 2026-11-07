type CheckoutSession = {
	sessionId: string;
	status?: string;
	busy?: boolean;
	cwd?: string;
	workspaceRoot?: string;
};

export async function checkoutIdleBranch(options: {
	cwd: string;
	branch: string;
	git: (cwd: string, args: string[]) => Promise<string>;
	sessions: () => Promise<CheckoutSession[]>;
}): Promise<void> {
	const { cwd, branch, git } = options;
	if (!branch.trim() || branch.startsWith("-"))
		throw new Error("Invalid branch name");
	const checkout = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
	for (const session of await options.sessions()) {
		if (
			!session.busy &&
			!["running", "starting", "stopping", "provisioning", "pending"].includes(
				session.status ?? "",
			)
		)
			continue;
		const path = session.cwd || session.workspaceRoot;
		if (!path)
			throw new Error(
				"Cannot verify a running task's checkout. Wait for it to finish before switching branches.",
			);
		// Resolve each working directory through Git so subfolders and symlinks match,
		// while independent worktrees remain independent checkouts.
		const root = (await git(path, ["rev-parse", "--show-toplevel"])).trim();
		if (root === checkout)
			throw new Error(
				"A running task or teammate is using this checkout. Wait for it to finish before switching branches.",
			);
	}
	if (
		(
			await git(cwd, ["status", "--porcelain", "--untracked-files=normal"])
		).trim()
	) {
		throw new Error(
			"This checkout has uncommitted changes. Commit or move them before switching branches; nothing was stashed or discarded.",
		);
	}
	await git(cwd, ["checkout", branch]);
}
