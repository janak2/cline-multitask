"use client";

import { useEffect } from "react";
import {
	setTerminalOpenForChat,
	type TerminalPanelsState,
} from "@/lib/terminal-panel-state";

export function useTerminalChatHandoff(
	threadKey: string | null,
	sessionKey: string | null,
	panels: TerminalPanelsState,
	update: (
		change: (current: TerminalPanelsState) => TerminalPanelsState,
	) => void,
) {
	const pending = Boolean(
		threadKey && sessionKey && panels.openChats.includes(threadKey),
	);
	useEffect(() => {
		if (!pending || !threadKey || !sessionKey) return;
		let cancelled = false;
		void import("@/lib/terminal-sessions").then((sessions) => {
			if (cancelled) return;
			sessions.renameTerminalChat(threadKey, sessionKey);
			update((current) =>
				current.openChats.includes(threadKey)
					? setTerminalOpenForChat(
							setTerminalOpenForChat(current, threadKey, false),
							sessionKey,
							true,
						)
					: current,
			);
		});
		return () => {
			cancelled = true;
		};
	}, [pending, threadKey, sessionKey, update]);
	return pending ? threadKey : (sessionKey ?? threadKey);
}
