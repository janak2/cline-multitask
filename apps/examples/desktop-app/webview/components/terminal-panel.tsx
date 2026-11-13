"use client";

import "@xterm/xterm/css/xterm.css";

import { MessageSquarePlus, Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WorkspacePanelFrame } from "@/components/views/chat/workspace-panel-frame";
import {
	activeTerminalTabId,
	applyTerminalTheme,
	createTerminalTab,
	killTerminalTab,
	listTerminalTabs,
	setActiveTerminalTab,
	spawnTerminalTab,
	subscribeTerminalTabs,
	type TerminalTab,
	terminalGroupKey,
} from "@/lib/terminal-sessions";
import { cn } from "@/lib/utils";

type TerminalPanelProps = {
	/** The chat these shells belong to; other chats never see them. */
	chatKey: string;
	/** Directory new shells start in; empty opens the home directory. */
	cwd: string;
	onClose: () => void;
	onAddToChat?: (text: string) => void;
};

/**
 * Right-hand terminal panel. Shell tabs are owned by `terminal-sessions` and
 * grouped by chat and directory, so this component only decides which tab is
 * visible and keeps xterm sized to the panel.
 */
export function TerminalPanel(props: TerminalPanelProps) {
	const group = terminalGroupKey(props.chatKey, props.cwd);
	// Remount per group so "no tabs" means "fresh panel" and not "the last
	// shell exited" when the chat or its workspace changes under the panel.
	return <TerminalPanelForGroup group={group} key={group} {...props} />;
}

const noTabs: TerminalTab[] = [];

function TerminalPanelForGroup({
	group,
	cwd,
	onClose,
	onAddToChat,
}: TerminalPanelProps & { group: string }) {
	const tabs = useSyncExternalStore(
		subscribeTerminalTabs,
		() => listTerminalTabs(group),
		() => noTabs,
	);
	const activeId = useSyncExternalStore(
		subscribeTerminalTabs,
		() => activeTerminalTabId(group),
		() => null,
	);
	const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
	const [selection, setSelection] = useState("");
	useEffect(() => {
		const update = () => setSelection(activeTab?.term.getSelection() ?? "");
		update();
		const subscription = activeTab?.term.onSelectionChange(update);
		return () => subscription?.dispose();
	}, [activeTab]);
	const hostRef = useRef<HTMLDivElement>(null);
	const hadTabsRef = useRef(false);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (tabs.length > 0) {
			hadTabsRef.current = true;
			return;
		}
		if (hadTabsRef.current) {
			// The last shell exited: close like an editor would.
			onCloseRef.current();
			return;
		}
		// Re-check the store: StrictMode replays this effect before the
		// subscription has delivered the tab created by the first run.
		if (listTerminalTabs(group).length === 0) createTerminalTab(group, cwd);
	}, [cwd, group, tabs.length]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || !activeTab) return;
		host.replaceChildren(activeTab.element);
		if (!activeTab.opened) {
			activeTab.term.open(activeTab.element);
			activeTab.opened = true;
		}
		activeTab.fit.fit();
		void spawnTerminalTab(activeTab);
		activeTab.term.focus();
		// A tab coming back from a detached element has stale row layout
		// until xterm redraws it.
		const frame = window.requestAnimationFrame(() => {
			activeTab.fit.fit();
			activeTab.term.refresh(0, activeTab.term.rows - 1);
		});
		const observer = new ResizeObserver(() => {
			window.requestAnimationFrame(() => activeTab.fit.fit());
		});
		observer.observe(host);
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			// Leave the element in the store, not in a stale host.
			activeTab.element.remove();
		};
	}, [activeTab]);

	useEffect(() => {
		// Tabs kept alive while the panel was hidden missed any theme change.
		applyTerminalTheme();
		const observer = new MutationObserver(applyTerminalTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-cline-accent"],
		});
		return () => observer.disconnect();
	}, []);

	return (
		<WorkspacePanelFrame id="terminal-panel">
			<section
				aria-label="Terminal"
				className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
			>
				{/* Tabs sit on the strip's bottom border; the active one paints over
			    it so it reads as attached to the terminal below. */}
				<div className="flex h-9 shrink-0 items-end gap-1 border-b border-border/60 bg-sidebar/50 px-2">
					<div className="flex min-w-0 items-end gap-0.5">
						{/* Tabs shrink and truncate rather than overflow, so + and hide stay reachable. */}
						{tabs.map((tab) => (
							<TerminalTabButton
								active={tab.id === activeTab?.id}
								key={tab.id}
								onClose={() => void killTerminalTab(tab)}
								onSelect={() => setActiveTerminalTab(group, tab.id)}
								tab={tab}
							/>
						))}
						<button
							aria-label="New terminal"
							className="mb-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
							onClick={() => createTerminalTab(group, cwd)}
							title="New terminal"
							type="button"
						>
							<Plus className="size-3.5" />
						</button>
					</div>
					<div className="mb-0.5 ml-auto flex shrink-0 items-center">
						<button
							className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
							disabled={!selection.trim() || !onAddToChat}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => onAddToChat?.(selection)}
							title="Add selected terminal text to the current chat"
							type="button"
						>
							<MessageSquarePlus className="size-3.5" />
							Add to chat
						</button>
						<button
							aria-label="Hide terminal"
							className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
							onClick={onClose}
							title="Hide terminal (Ctrl+`)"
							type="button"
						>
							<X className="size-3.5" />
						</button>
					</div>
				</div>
				<div
					className="cline-chat-selectable min-h-0 flex-1 overflow-hidden px-3 py-2"
					ref={hostRef}
				/>
			</section>
		</WorkspacePanelFrame>
	);
}

function TerminalTabButton({
	tab,
	active,
	onSelect,
	onClose,
}: {
	tab: TerminalTab;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	return (
		<div className={cn("group/tab relative min-w-0", active && "-mb-px")}>
			<button
				aria-current={active ? "true" : undefined}
				className={cn(
					"inline-flex h-8 w-full items-center gap-1.5 rounded-t-md border border-b-0 pl-2.5 pr-7 text-xs",
					active
						? "border-border/60 bg-background text-foreground"
						: "border-transparent text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground",
				)}
				onClick={onSelect}
				type="button"
			>
				<SquareTerminal className="size-3.5 shrink-0" />
				<span className="min-w-0 max-w-40 truncate">{tab.label}</span>
			</button>
			<button
				aria-label={`Close ${tab.label}`}
				className="absolute right-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-surface-hover-lighter hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
				title="Kill terminal"
				type="button"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
