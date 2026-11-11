"use client";

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { isTauriAvailable } from "@/lib/desktop-client";
import { isMacPlatform } from "@/lib/keybindings";

/**
 * Terminal tabs live outside React, grouped by the chat that opened them, so
 * switching away and back reattaches the same shell and scrollback instead of
 * spawning a new one, and one chat's shells never show in another chat.
 */
export type TerminalTab = {
	id: string;
	/** The owning chat's group: its chat key and starting directory. */
	group: string;
	cwd: string;
	label: string;
	term: Terminal;
	fit: FitAddon;
	/** xterm renders into this element; the panel moves it into place. */
	element: HTMLDivElement;
	opened: boolean;
	/** "new" allows (re)starting; "exited" tabs are about to be removed. */
	status: "new" | "starting" | "running" | "exited";
	/** Native shell handle; null until spawned and after exit. */
	pty: {
		write: (data: string) => void;
		resize: (cols: number, rows: number) => void;
	} | null;
};

type PtyEvent =
	| { type: "data"; data: string }
	| { type: "exit"; code?: number };

const tabsByGroup = new Map<string, TerminalTab[]>();
const activeIdByGroup = new Map<string, string>();
const listeners = new Set<() => void>();
let nextTabNumber = 1;

function emit(): void {
	for (const listener of listeners) listener();
}

export function subscribeTerminalTabs(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function normalizeTerminalCwd(cwd: string): string {
	const trimmed = cwd.trim();
	if (!trimmed) return "~";
	const stripped = trimmed.replace(/[\\/]+$/, "");
	// Filesystem roots keep their separator: "/" and "C:\" are directories,
	// "" and "C:" are not.
	if (!stripped) return trimmed.slice(0, 1);
	if (/^[A-Za-z]:$/.test(stripped)) return `${stripped}\\`;
	return stripped;
}

const EMPTY: TerminalTab[] = [];

/** One chat's shells in one directory; a chat that changes folder gets a new group. */
export function terminalGroupKey(chatKey: string, cwd: string): string {
	return `${chatKey}\u0000${normalizeTerminalCwd(cwd)}`;
}

/**
 * Moves a chat's shells to its new key (a new chat gains its saved session id
 * on its first message), so the shells it already opened stay with it.
 */
export function renameTerminalChat(
	fromChatKey: string,
	toChatKey: string,
): void {
	let moved = false;
	for (const [group, tabs] of [...tabsByGroup]) {
		const prefix = `${fromChatKey}\u0000`;
		if (!group.startsWith(prefix)) continue;
		const next = `${toChatKey}\u0000${group.slice(prefix.length)}`;
		if (tabsByGroup.has(next)) continue;
		for (const tab of tabs) tab.group = next;
		tabsByGroup.set(next, tabs);
		tabsByGroup.delete(group);
		const active = activeIdByGroup.get(group);
		if (active) activeIdByGroup.set(next, active);
		activeIdByGroup.delete(group);
		moved = true;
	}
	if (moved) emit();
}

export function listTerminalTabs(group: string): TerminalTab[] {
	return tabsByGroup.get(group) ?? EMPTY;
}

export function activeTerminalTabId(group: string): string | null {
	const tabs = tabsByGroup.get(group);
	if (!tabs || tabs.length === 0) return null;
	const active = activeIdByGroup.get(group);
	return tabs.some((tab) => tab.id === active) ? (active ?? null) : tabs[0].id;
}

export function setActiveTerminalTab(group: string, id: string): void {
	activeIdByGroup.set(group, id);
	emit();
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

function tabLabel(key: string, existing: TerminalTab[]): string {
	const base = key === "~" ? "home" : basename(key);
	const taken = new Set(existing.map((tab) => tab.label));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const candidate = `${base} ${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * xterm only understands sRGB-ish color syntax, while the theme tokens are
 * oklch(); a canvas fill round-trips any CSS color into #rrggbb.
 */
function resolveCssColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return fallback;
	context.fillStyle = "#000";
	context.fillStyle = trimmed;
	const resolved = context.fillStyle;
	return typeof resolved === "string" && resolved !== "#000000"
		? resolved
		: fallback;
}

export function readTerminalTheme(): ITheme {
	const styles = getComputedStyle(document.documentElement);
	const dark = document.documentElement.classList.contains("dark");
	const background = resolveCssColor(
		styles.getPropertyValue("--background"),
		dark ? "#09090b" : "#ffffff",
	);
	const foreground = resolveCssColor(
		styles.getPropertyValue("--foreground"),
		dark ? "#e4e4e7" : "#18181b",
	);
	const primary = resolveCssColor(
		styles.getPropertyValue("--primary"),
		dark ? "#a78bfa" : "#7c3aed",
	);
	const muted = resolveCssColor(
		styles.getPropertyValue("--muted-foreground"),
		dark ? "#a1a1aa" : "#71717a",
	);
	return {
		background,
		foreground,
		cursor: primary,
		cursorAccent: dark ? "#000000" : "#ffffff",
		selectionBackground: dark
			? "rgba(167, 139, 250, 0.35)"
			: "rgba(124, 58, 237, 0.25)",
		brightBlack: muted,
		// The stock dark palette's yellow and cyan wash out on a light surface.
		...(dark
			? {}
			: {
					yellow: "#a16207",
					brightYellow: "#ca8a04",
					cyan: "#0e7490",
					brightCyan: "#0891b2",
					white: "#52525b",
					brightWhite: "#18181b",
					green: "#15803d",
					brightGreen: "#16a34a",
				}),
	};
}

function readMonoFontFamily(): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue("--font-mono")
		.trim();
	return value || "ui-monospace, Menlo, Consolas, monospace";
}

export function createTerminalTab(group: string, cwd: string): TerminalTab {
	const key = normalizeTerminalCwd(cwd);
	const existing = tabsByGroup.get(group) ?? [];
	const term = new Terminal({
		allowProposedApi: true,
		cursorBlink: true,
		cursorStyle: "bar",
		fontFamily: readMonoFontFamily(),
		fontSize: 12.5,
		lineHeight: 1.2,
		scrollback: 5_000,
		macOptionIsMeta: true,
		theme: readTerminalTheme(),
	});
	// xterm keeps its own selection and binds no copy key. macOS gets Cmd+C
	// from the native Edit menu; elsewhere Ctrl+C is SIGINT, so terminals
	// copy on Ctrl+Shift+C (Ctrl+Shift+V already pastes via the browser).
	term.attachCustomKeyEventHandler((event) => {
		if (
			event.type !== "keydown" ||
			isMacPlatform() ||
			!event.ctrlKey ||
			!event.shiftKey ||
			event.code !== "KeyC"
		) {
			return true;
		}
		const selection = term.getSelection();
		if (selection) void navigator.clipboard.writeText(selection);
		return false;
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	const element = document.createElement("div");
	element.className = "h-full w-full";
	const tab: TerminalTab = {
		id: `term_${Date.now().toString(36)}_${nextTabNumber++}`,
		group,
		cwd: key,
		label: tabLabel(key, existing),
		term,
		fit,
		element,
		opened: false,
		status: "new",
		pty: null,
	};
	// Registered once here rather than per spawn attempt, so a retried start
	// cannot stack listeners and send every keystroke twice.
	term.onData((data) => tab.pty?.write(data));
	term.onResize(({ cols, rows }) => tab.pty?.resize(cols, rows));
	tabsByGroup.set(group, [...existing, tab]);
	activeIdByGroup.set(group, tab.id);
	emit();
	return tab;
}

function removeTab(tab: TerminalTab): void {
	const tabs = tabsByGroup.get(tab.group);
	if (!tabs) return;
	const index = tabs.indexOf(tab);
	if (index === -1) return;
	const next = tabs.filter((candidate) => candidate !== tab);
	if (next.length === 0) {
		tabsByGroup.delete(tab.group);
		activeIdByGroup.delete(tab.group);
	} else {
		tabsByGroup.set(tab.group, next);
		if (activeIdByGroup.get(tab.group) === tab.id) {
			activeIdByGroup.set(tab.group, next[Math.min(index, next.length - 1)].id);
		}
	}
	tab.term.dispose();
	tab.element.remove();
	emit();
}

export async function killTerminalTab(tab: TerminalTab): Promise<void> {
	const wasLive = tab.status === "starting" || tab.status === "running";
	tab.status = "exited";
	tab.pty = null;
	removeTab(tab);
	if (wasLive && isTauriAvailable()) {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("terminal_kill", { id: tab.id }).catch(() => {
			// Already gone.
		});
	}
}

export function applyTerminalTheme(): void {
	const theme = readTerminalTheme();
	for (const tabs of tabsByGroup.values()) {
		for (const tab of tabs) {
			tab.term.options.theme = theme;
		}
	}
}

/**
 * Starts the shell for a tab the first time it is shown. Output streams
 * straight into xterm; when the shell exits the tab closes itself, matching
 * how editors treat a finished terminal.
 */
let windowsBuild: Promise<number | null> | null = null;

export async function spawnTerminalTab(tab: TerminalTab): Promise<void> {
	if (tab.status !== "new") return;
	tab.status = "starting";
	if (!isTauriAvailable()) {
		tab.status = "exited";
		tab.term.writeln(
			"\x1b[2mThe integrated terminal needs the desktop app; it is unavailable in browser mode.\x1b[0m",
		);
		return;
	}
	const { Channel, invoke } = await import("@tauri-apps/api/core");
	// On Windows, xterm must match ConPTY's wrapping and reflow, which depend
	// on the OS build; set before spawning so the first output wraps right.
	windowsBuild ??= invoke<number | null>("terminal_windows_build").catch(
		() => null,
	);
	const buildNumber = await windowsBuild;
	// Closed while the imports above were pending: its xterm is disposed and
	// a shell started now would have no tab to reach it.
	if (tab.status !== "starting") return;
	if (buildNumber) {
		tab.term.options.windowsPty = { backend: "conpty", buildNumber };
	}
	const channel = new Channel<PtyEvent>();
	channel.onmessage = (event) => {
		if (event.type === "data") {
			tab.term.write(event.data);
			return;
		}
		if (tab.status === "exited") return;
		tab.status = "exited";
		tab.pty = null;
		// Let the shell's final output land before the tab goes away.
		window.setTimeout(() => void removeTab(tab), 150);
	};
	tab.pty = {
		write: (data) => {
			void invoke("terminal_write", { id: tab.id, data }).catch(() => {
				// The shell exited between the keystroke and the write.
			});
		},
		resize: (cols, rows) => {
			void invoke("terminal_resize", { id: tab.id, cols, rows }).catch(() => {
				// Resize races with exit; nothing to do.
			});
		},
	};
	try {
		await invoke("terminal_spawn", {
			options: {
				id: tab.id,
				cwd: tab.cwd === "~" ? null : tab.cwd,
				cols: tab.term.cols,
				rows: tab.term.rows,
			},
			onEvent: channel,
		});
		if (tab.status === "starting") {
			tab.status = "running";
		} else if (tab.status === "exited") {
			// Closed while the spawn was in flight, so its terminal_kill ran
			// before the shell existed. (A no-op if the shell already exited.)
			void invoke("terminal_kill", { id: tab.id }).catch(() => {});
		}
	} catch (error) {
		if (tab.status !== "starting") return;
		// Back to "new" so showing the tab again retries the spawn.
		tab.status = "new";
		tab.pty = null;
		const message = error instanceof Error ? error.message : String(error);
		tab.term.writeln(`\x1b[31m${message}\x1b[0m`);
	}
}
