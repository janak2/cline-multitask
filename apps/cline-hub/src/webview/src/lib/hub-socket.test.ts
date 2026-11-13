import { describe, expect, it, vi } from "vitest";
import type { WebviewOutboundMessage } from "../../../webview-protocol";
import { HubSocket, type HubSocketConnection } from "./hub-socket";

type Listener = (event: { data?: unknown }) => void;

class FakeSocket implements HubSocketConnection {
	readyState = 0;
	sent: unknown[] = [];
	private listeners = new Map<string, Listener[]>();
	addEventListener(type: string, listener: Listener) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		this.drop();
	}
	open() {
		this.readyState = 1;
		this.emit("open");
	}
	drop() {
		this.readyState = 3;
		this.emit("error");
		this.emit("close");
	}
	private emit(type: string, event: { data?: unknown } = {}) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function setup() {
	const sockets: FakeSocket[] = [];
	const dispatched: WebviewOutboundMessage[] = [];
	const timers: Array<() => void> = [];
	const socket = new HubSocket({
		create: () => {
			const next = new FakeSocket();
			sockets.push(next);
			return next;
		},
		dispatch: (message) => dispatched.push(message),
		setTimer: (run) => {
			timers.push(run);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: vi.fn(),
	});
	return { socket, sockets, dispatched, timers };
}

describe("HubSocket", () => {
	it("reconnects after the phone drops the connection and reopens the chat", () => {
		const { socket, sockets, dispatched, timers } = setup();
		socket.post({ type: "ready" });
		sockets[0].open();
		socket.post({ type: "attachSession", sessionId: "s1" });
		expect(sockets[0].sent).toEqual([
			{ type: "ready" },
			{ type: "attachSession", sessionId: "s1" },
		]);

		sockets[0].drop();
		// A dropped connection is not shown as a chat error.
		expect(dispatched.some((message) => message.type === "error")).toBe(false);
		expect(timers).toHaveLength(1);

		timers[0]();
		sockets[1].open();
		expect(sockets[1].sent).toEqual([
			{ type: "ready" },
			{ type: "attachSession", sessionId: "s1" },
		]);
		expect(dispatched.at(-1)).toEqual({
			type: "status",
			text: "Reconnected to the Cline Hub server.",
		});
	});

	it("reconnects at once when the page is shown again", () => {
		const { socket, sockets } = setup();
		socket.post({ type: "ready" });
		sockets[0].open();
		sockets[0].drop();
		socket.wake();
		expect(sockets).toHaveLength(2);
		socket.wake();
		expect(sockets).toHaveLength(2);
	});

	it("forgets the open chat after New chat and does not replay commands", () => {
		const { socket, sockets, timers } = setup();
		socket.post({ type: "ready" });
		sockets[0].open();
		socket.post({ type: "attachSession", sessionId: "s1" });
		socket.post({ type: "reset" });
		sockets[0].drop();
		socket.post({
			type: "desktopCommand",
			id: "c1",
			command: "list_session_terminals",
		});
		sockets[1].drop();
		timers.at(-1)?.();
		sockets[2].open();
		expect(sockets[2].sent).toEqual([{ type: "ready" }]);
	});
});
