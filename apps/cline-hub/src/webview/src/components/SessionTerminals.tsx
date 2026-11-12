import { Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import type { WebviewTerminalSnapshot } from "../../../webview-protocol";

/** How often the open view re-reads the desktop app's terminal text. */
const REFRESH_MS = 2_000;

/**
 * Read-only view of the terminal tabs the desktop app has open for a
 * session. Nothing typed here reaches the shell.
 */
export function SessionTerminals({
	onClose,
	sessionId,
}: {
	onClose: () => void;
	sessionId: string;
}) {
	const [terminals, setTerminals] = useState<WebviewTerminalSnapshot[]>();
	const [error, setError] = useState<string>();
	const [activeId, setActiveId] = useState<string>();
	const outputRef = useRef<HTMLPreElement>(null);
	const followRef = useRef(true);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const next = await desktopClient.invoke<WebviewTerminalSnapshot[]>(
					"list_session_terminals",
					{ sessionId },
				);
				if (cancelled) return;
				setTerminals(next);
				setError(undefined);
			} catch (loadError) {
				if (cancelled) return;
				setError(
					loadError instanceof Error ? loadError.message : String(loadError),
				);
			}
		};
		void load();
		const timer = setInterval(() => void load(), REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [sessionId]);

	const active =
		terminals?.find((terminal) => terminal.id === activeId) ?? terminals?.[0];

	// Stay at the bottom as output grows, unless the user scrolled up to read.
	useEffect(() => {
		const element = outputRef.current;
		if (element && followRef.current) element.scrollTop = element.scrollHeight;
	});

	return (
		<div
			aria-label="Session terminals"
			className="fixed inset-0 z-50 flex flex-col bg-background"
			role="dialog"
		>
			<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
				<div className="min-w-0">
					<p className="text-sm font-semibold">Terminals</p>
					<p className="truncate text-xs text-muted-foreground">
						{active?.cwd ?? "Open in the desktop app; view only here"}
					</p>
				</div>
				<Button
					aria-label="Close terminals"
					onClick={onClose}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			</div>
			{terminals && terminals.length > 1 ? (
				<div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
					{terminals.map((terminal) => (
						<button
							className={cn(
								"shrink-0 rounded-md px-2.5 py-1 text-xs",
								terminal.id === active?.id
									? "bg-accent font-medium text-accent-foreground"
									: "text-muted-foreground",
							)}
							key={terminal.id}
							onClick={() => {
								followRef.current = true;
								setActiveId(terminal.id);
							}}
							type="button"
						>
							{terminal.label}
						</button>
					))}
				</div>
			) : null}
			{terminals === undefined && !error ? (
				<div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" />
					Loading terminals…
				</div>
			) : !active ? (
				<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
					{error ??
						"No terminals are open for this session. Open one in the desktop app's terminal panel to see it here."}
				</div>
			) : (
				<pre
					className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-zinc-100"
					data-testid="terminal-output"
					onScroll={(event) => {
						const element = event.currentTarget;
						followRef.current =
							element.scrollHeight - element.scrollTop - element.clientHeight <
							24;
					}}
					ref={outputRef}
				>
					{active.text || " "}
				</pre>
			)}
		</div>
	);
}
