type TreeSession = {
	sessionId: string;
	parentSessionId?: string;
	status?: string;
	createdAt?: number;
	updatedAt?: number;
};

export type SessionTreeNode<T extends TreeSession> = {
	session: T;
	children: SessionTreeNode<T>[];
};

/**
 * Nests sessions under their parent session. Roots keep the input order;
 * children are ordered by start time. A session whose parent is not in the
 * list is treated as a root.
 */
export function buildSessionTree<T extends TreeSession>(
	sessions: T[],
): SessionTreeNode<T>[] {
	const ids = new Set(sessions.map((session) => session.sessionId));
	const parentOf = (session: T) =>
		session.parentSessionId &&
		session.parentSessionId !== session.sessionId &&
		ids.has(session.parentSessionId)
			? session.parentSessionId
			: undefined;
	const toNode = (session: T): SessionTreeNode<T> => ({
		session,
		children: sessions
			.filter((child) => parentOf(child) === session.sessionId)
			.sort((a, b) => startTime(a) - startTime(b))
			.map(toNode),
	});
	return sessions.filter((session) => !parentOf(session)).map(toNode);
}

/** Lists the rows to render, skipping the children of collapsed nodes. */
export function visibleSessionRows<T extends TreeSession>(
	nodes: SessionTreeNode<T>[],
	isExpanded: (node: SessionTreeNode<T>) => boolean,
	depth = 0,
): { node: SessionTreeNode<T>; depth: number }[] {
	return nodes.flatMap((node) => [
		{ node, depth },
		...(node.children.length > 0 && isExpanded(node)
			? visibleSessionRows(node.children, isExpanded, depth + 1)
			: []),
	]);
}

export function hasRunningDescendant<T extends TreeSession>(
	node: SessionTreeNode<T>,
): boolean {
	return node.children.some(
		(child) =>
			child.session.status?.toLowerCase() === "running" ||
			hasRunningDescendant(child),
	);
}

function startTime(session: TreeSession): number {
	return session.createdAt ?? session.updatedAt ?? 0;
}
