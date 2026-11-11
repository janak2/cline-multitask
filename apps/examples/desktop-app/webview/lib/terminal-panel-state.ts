export const TERMINAL_PANEL_STORAGE_KEY = "cline.code.terminal-panel.v1";

export const TERMINAL_PANEL_MIN_HEIGHT = 120;
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;

export type TerminalPanelState = {
	open: boolean;
	height: number;
};

/** Chats with the terminal panel open, by chat key; the height is shared. */
export type TerminalPanelsState = {
	openChats: string[];
	height: number;
};

export const TERMINAL_PANELS_STORAGE_KEY = "cline.code.terminal-panels.v2";
/** Remembered open chats; older ones drop off so the list stays small. */
export const MAX_OPEN_TERMINAL_CHATS = 50;

export function parseTerminalPanelsState(
	raw: string | null,
	legacy: TerminalPanelState,
): TerminalPanelsState {
	const fallback = { openChats: [], height: legacy.height };
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw) as Partial<TerminalPanelsState> | null;
		if (!parsed || typeof parsed !== "object") return fallback;
		return {
			openChats: Array.isArray(parsed.openChats)
				? parsed.openChats
						.filter((key): key is string => typeof key === "string")
						.slice(0, MAX_OPEN_TERMINAL_CHATS)
				: [],
			height:
				typeof parsed.height === "number" && Number.isFinite(parsed.height)
					? Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(parsed.height))
					: legacy.height,
		};
	} catch {
		return fallback;
	}
}

/** Opens or closes the panel for one chat, most recent first. */
export function setTerminalOpenForChat(
	state: TerminalPanelsState,
	chatKey: string,
	open: boolean,
): TerminalPanelsState {
	const others = state.openChats.filter((key) => key !== chatKey);
	return {
		...state,
		openChats: open
			? [chatKey, ...others].slice(0, MAX_OPEN_TERMINAL_CHATS)
			: others,
	};
}

export function readTerminalPanelsState(): TerminalPanelsState {
	const legacy = readTerminalPanelState();
	if (typeof window === "undefined")
		return { openChats: [], height: legacy.height };
	try {
		return parseTerminalPanelsState(
			window.localStorage.getItem(TERMINAL_PANELS_STORAGE_KEY),
			legacy,
		);
	} catch {
		return { openChats: [], height: legacy.height };
	}
}

export function writeTerminalPanelsState(state: TerminalPanelsState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			TERMINAL_PANELS_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Storage unavailable: panels just start closed next launch.
	}
}

export function parseTerminalPanelState(
	raw: string | null,
): TerminalPanelState {
	const fallback = { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw) as Partial<TerminalPanelState> | null;
		if (!parsed || typeof parsed !== "object") return fallback;
		return {
			open: parsed.open === true,
			height:
				typeof parsed.height === "number" && Number.isFinite(parsed.height)
					? Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(parsed.height))
					: fallback.height,
		};
	} catch {
		return fallback;
	}
}

export function readTerminalPanelState(): TerminalPanelState {
	if (typeof window === "undefined") {
		return { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	}
	try {
		return parseTerminalPanelState(
			window.localStorage.getItem(TERMINAL_PANEL_STORAGE_KEY),
		);
	} catch {
		return { open: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT };
	}
}

export function writeTerminalPanelState(state: TerminalPanelState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			TERMINAL_PANEL_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Storage unavailable: the panel just starts closed next launch.
	}
}

/** Keeps the panel from swallowing the whole window or collapsing to nothing. */
export function clampTerminalPanelHeight(
	height: number,
	viewportHeight: number,
): number {
	const max = Math.max(
		TERMINAL_PANEL_MIN_HEIGHT,
		Math.floor(viewportHeight * 0.8),
	);
	return Math.min(max, Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(height)));
}
