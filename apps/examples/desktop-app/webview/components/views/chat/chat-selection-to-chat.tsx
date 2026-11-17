"use client";

import { MessageSquarePlus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export function ChatSelectionToChat({
	children,
	onAddToChat,
}: {
	children: ReactNode;
	onAddToChat?: (text: string) => void;
}) {
	const content = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState<{
		text: string;
		left: number;
		top: number;
	} | null>(null);
	useEffect(() => {
		if (!onAddToChat) return;
		const clear = () => setSelected(null);
		const update = (event: Event) => {
			if (event instanceof KeyboardEvent && event.key === "Escape") return;
			const selection = window.getSelection();
			const root = content.current;
			if (
				!selection ||
				selection.isCollapsed ||
				!selection.rangeCount ||
				!root?.contains(selection.anchorNode) ||
				!root.contains(selection.focusNode) ||
				!selection.toString().trim()
			) {
				clear();
				return;
			}
			const range = selection.getRangeAt(0);
			const element =
				range.commonAncestorContainer instanceof Element
					? range.commonAncestorContainer
					: range.commonAncestorContainer.parentElement;
			if (element?.closest("textarea, input, [contenteditable], button")) {
				clear();
				return;
			}
			const rect = range.getBoundingClientRect();
			setSelected({
				text: selection.toString(),
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 144)),
				top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 44)),
			});
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") clear();
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("mouseup", update);
		document.addEventListener("keyup", update);
		document.addEventListener("keydown", handleEscape);
		window.addEventListener("scroll", clear, true);
		window.addEventListener("resize", clear);
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("mouseup", update);
			document.removeEventListener("keyup", update);
			document.removeEventListener("keydown", handleEscape);
			window.removeEventListener("scroll", clear, true);
			window.removeEventListener("resize", clear);
		};
	}, [onAddToChat]);
	return (
		<div ref={content} className="cline-chat-selectable h-full min-h-0 min-w-0">
			{children}
			{selected &&
				onAddToChat &&
				createPortal(
					<Button
						className="fixed z-50 shadow-md"
						size="sm"
						variant="outline"
						style={{ left: selected.left, top: selected.top }}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							onAddToChat(selected.text);
							setSelected(null);
							window.getSelection()?.removeAllRanges();
						}}
					>
						<MessageSquarePlus className="size-3.5" />
						Add to chat
					</Button>,
					document.body,
				)}
		</div>
	);
}
