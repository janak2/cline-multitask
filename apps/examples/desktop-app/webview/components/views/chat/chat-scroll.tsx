"use client";

import {
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScroller,
} from "@cline/ui/components/message-scroller";
import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-schema";

type MessageMark = { createdAt: number; content: string; reasoning?: string };
type Position = { top: number; atEnd: boolean; latest: MessageMark | null };

export const chatScrollPositions = new Map<string, Position>();

function latestMessage(messages: ChatMessage[]): MessageMark | null {
	let latest: ChatMessage | undefined;
	for (const message of messages) {
		if (
			message.role !== "status" &&
			(!latest || message.createdAt >= latest.createdAt)
		) {
			latest = message;
		}
	}
	return latest
		? {
				createdAt: latest.createdAt,
				content: latest.content,
				reasoning: latest.reasoning,
			}
		: null;
}

function hasNewOutput(saved: MessageMark | null, latest: MessageMark | null) {
	if (!latest) return false;
	if (!saved) return true;
	return (
		latest.createdAt > saved.createdAt ||
		(latest.createdAt === saved.createdAt &&
			(latest.content !== saved.content ||
				latest.reasoning !== saved.reasoning))
	);
}

export function ChatScrollProvider({
	sessionId,
	children,
}: {
	sessionId: string | null;
	children: React.ReactNode;
}) {
	const [saved] = useState(() =>
		sessionId ? chatScrollPositions.get(sessionId) : undefined,
	);
	return (
		<MessageScrollerProvider
			autoScroll
			defaultScrollPosition={saved ? "start" : "end"}
			scrollMargin={24}
		>
			{children}
		</MessageScrollerProvider>
	);
}

export function ChatScrollViewport({
	sessionId,
	messages,
	ready,
	...props
}: ComponentProps<typeof MessageScrollerViewport> & {
	sessionId: string | null;
	messages: ChatMessage[];
	ready: boolean;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [saved] = useState(() =>
		sessionId ? chatScrollPositions.get(sessionId) : undefined,
	);
	const restored = useRef(false);
	const latest = latestMessage(messages);
	const latestRef = useRef(latest);
	latestRef.current = latest;
	const { scrollToStart, scrollToEnd } = useMessageScroller();

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !ready || restored.current) return;
		if (!saved) {
			restored.current = true;
			return;
		}
		let frame = 0;
		const restore = () => {
			if (restored.current || viewport.clientHeight === 0) return;
			const bottom =
				!saved || saved.atEnd || hasNewOutput(saved.latest, latestRef.current);
			if (bottom) {
				scrollToEnd({ behavior: "auto" });
			} else {
				scrollToStart({ behavior: "auto" });
				viewport.scrollTop = saved.top;
				viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
				if (viewport.scrollHeight - viewport.clientHeight < saved.top) return;
			}
			restored.current = true;
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(restore);
		};
		const stopRestoring = () => {
			restored.current = true;
		};
		viewport.addEventListener("wheel", stopRestoring, { passive: true });
		viewport.addEventListener("touchmove", stopRestoring, { passive: true });
		viewport.addEventListener("keydown", stopRestoring);
		const observer =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(schedule)
				: null;
		observer?.observe(viewport);
		if (viewport.firstElementChild)
			observer?.observe(viewport.firstElementChild);
		schedule();
		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
			viewport.removeEventListener("wheel", stopRestoring);
			viewport.removeEventListener("touchmove", stopRestoring);
			viewport.removeEventListener("keydown", stopRestoring);
		};
	}, [ready, saved, scrollToEnd, scrollToStart]);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		return () => {
			if (!sessionId || !viewport || !restored.current) return;
			chatScrollPositions.set(sessionId, {
				top: viewport.scrollTop,
				atEnd:
					viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
					8,
				latest: latestRef.current,
			});
		};
	}, [sessionId]);

	return <MessageScrollerViewport {...props} ref={viewportRef} />;
}
