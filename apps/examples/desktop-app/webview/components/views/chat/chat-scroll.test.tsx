// @vitest-environment jsdom

import {
	MessageScrollerContent,
	MessageScrollerItem,
} from "@cline/ui/components/message-scroller";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { ChatScrollProvider, ChatScrollViewport } from "./chat-scroll";

let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
let sequence = 0;
let prefix: string;
const message = (
	createdAt = 1,
	content = "Answer",
	role: ChatMessage["role"] = "assistant",
): ChatMessage => ({
	id: `message-${createdAt}`,
	sessionId: "session",
	role,
	content,
	createdAt,
});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	prefix = `test-${sequence++}`;
	frames = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		frames.push(callback),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
	vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
	HTMLElement.prototype.scrollTo = function (options: ScrollToOptions) {
		this.scrollTop = options.top ?? 0;
	};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function render(session: string, messages = [message()], ready = true) {
	await act(async () =>
		root.render(
			<ChatScrollProvider key={prefix + session} sessionId={prefix + session}>
				<ChatScrollViewport
					sessionId={prefix + session}
					messages={messages}
					ready={ready}
				>
					<MessageScrollerContent>
						{messages.map((item) => (
							<MessageScrollerItem key={item.id} messageId={item.id}>
								{item.content}
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</ChatScrollViewport>
			</ChatScrollProvider>,
		),
	);
	await act(async () => {
		const pending = frames;
		frames = [];
		for (const callback of pending) callback(0);
	});
	return container.querySelector<HTMLElement>(
		'[data-slot="message-scroller-viewport"]',
	)!;
}

describe("chat scroll restoration", () => {
	it("keeps distinct positions when switching away and back unchanged", async () => {
		(await render("a")).scrollTop = 240;
		(await render("b")).scrollTop = 560;
		expect((await render("a")).scrollTop).toBe(240);
		expect((await render("b")).scrollTop).toBe(560);
	});

	it("starts at bottom for a new message received while away", async () => {
		(await render("a")).scrollTop = 240;
		await render("b");
		expect(
			(await render("a", [message(), message(2, "New answer")])).scrollTop,
		).toBe(1000);
	});

	it("ignores older history hydration, replaced IDs and status-only updates", async () => {
		(await render("a", [message(10)])).scrollTop = 240;
		await render("b");
		await render("a", [], false);
		expect(
			(
				await render("a", [
					message(1),
					{ ...message(10), id: "canonical-id" },
					message(20, "Completed", "status"),
				])
			).scrollTop,
		).toBe(240);
	});

	it("moves to bottom when the latest streaming answer grew while away", async () => {
		(await render("a", [message(10, "Partial")])).scrollTop = 240;
		await render("b");
		expect(
			(await render("a", [message(10, "Partial answer completed")])).scrollTop,
		).toBe(1000);
	});

	it("does not replay restoration over manual scrolling in the active chat", async () => {
		(await render("a")).scrollTop = 240;
		await render("b");
		const viewport = await render("a");
		viewport.dispatchEvent(new Event("wheel", { bubbles: true }));
		viewport.scrollTop = 420;
		expect((await render("a", [message(1, "Updated")])).scrollTop).toBe(420);
	});

	it("opens fresh chats at bottom and preserves a saved bottom position", async () => {
		expect((await render("a")).scrollTop).toBe(1000);
		await render("b");
		expect((await render("a")).scrollTop).toBe(1000);
	});
	it("preserves the visible position when older messages are prepended", async () => {
		const viewport = await render("a", [message(10)]);
		viewport.scrollTop = 240;
		viewport.dispatchEvent(new Event("scroll"));
		vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
			1700,
		);
		expect((await render("a", [message(1), message(10)])).scrollTop).toBe(740);
	});
});
