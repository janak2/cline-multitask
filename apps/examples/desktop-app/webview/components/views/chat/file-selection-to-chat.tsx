"use client";

import { MessageSquarePlus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function FileSelectionToChat({
	children,
	resourceKey,
	onAddToChat,
}: {
	children: ReactNode;
	resourceKey: string;
	onAddToChat?: (text: string) => void;
}) {
	const content = useRef<HTMLDivElement>(null);
	const [selection, setSelection] = useState("");
	useEffect(() => {
		void resourceKey;
		setSelection("");
		const update = () => {
			const root = content.current;
			const active = document.activeElement;
			if (
				(active instanceof HTMLTextAreaElement ||
					active instanceof HTMLInputElement) &&
				root?.contains(active)
			) {
				setSelection(
					active.value.slice(
						active.selectionStart ?? 0,
						active.selectionEnd ?? 0,
					),
				);
				return;
			}
			const selected = window.getSelection();
			setSelection(
				selected?.anchorNode &&
					selected.focusNode &&
					root?.contains(selected.anchorNode) &&
					root.contains(selected.focusNode)
					? selected.toString()
					: "",
			);
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("select", update, true);
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("select", update, true);
		};
	}, [resourceKey]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 justify-end border-b border-border/60 px-2 py-1">
				<Button
					size="sm"
					variant="ghost"
					disabled={!selection.trim() || !onAddToChat}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onAddToChat?.(selection)}
				>
					<MessageSquarePlus className="size-3.5" />
					Add to chat
				</Button>
			</div>
			<div ref={content} className="relative min-h-0 flex-1">
				{children}
			</div>
		</div>
	);
}
