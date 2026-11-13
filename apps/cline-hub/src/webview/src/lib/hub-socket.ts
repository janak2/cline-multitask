import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
} from "../../../webview-protocol";

/** The parts of a WebSocket this uses; a fake can stand in for tests. */
export type HubSocketConnection = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(
		type: "open" | "close" | "error" | "message",
		listener: (event: { data?: unknown }) => void,
	): void;
};

const CONNECTING = 0;
const OPEN = 1;

export type HubSocketOptions = {
	create: () => HubSocketConnection;
	dispatch: (message: WebviewOutboundMessage) => void;
	setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

/** Waits between reconnect attempts; the last one repeats. */
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * The browser's connection to the Cline Hub server. Phones close it when the
 * page goes to the background, so it reconnects on its own, and on
 * reconnecting re-sends `ready` and re-opens the chat that was open, since
 * the server treats the new connection as a new page.
 */
export class HubSocket {
	private socket: HubSocketConnection | undefined;
	private pending: WebviewInboundMessage[] = [];
	private readyMessage: WebviewInboundMessage | undefined;
	private attachMessage: WebviewInboundMessage | undefined;
	private attempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private hasConnected = false;

	private readonly options: HubSocketOptions;

	constructor(options: HubSocketOptions) {
		this.options = options;
	}

	post(message: WebviewInboundMessage): void {
		this.remember(message);
		const socket = this.connect();
		if (socket.readyState === OPEN) {
			socket.send(JSON.stringify(message));
			return;
		}
		this.pending.push(message);
	}

	/** Reconnects at once if the connection is down, e.g. when the page is shown again. */
	wake(): void {
		if (!this.hasConnected && !this.socket) return;
		if (
			this.socket &&
			(this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)
		) {
			return;
		}
		this.cancelReconnect();
		this.connect();
	}

	private remember(message: WebviewInboundMessage): void {
		if (message.type === "ready") {
			this.readyMessage = message;
		} else if (message.type === "attachSession") {
			this.attachMessage = message;
		} else if (
			message.type === "reset" ||
			(message.type === "deleteSession" &&
				this.attachMessage?.type === "attachSession" &&
				this.attachMessage.sessionId === message.sessionId)
		) {
			this.attachMessage = undefined;
		}
	}

	private connect(): HubSocketConnection {
		if (
			this.socket &&
			(this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)
		) {
			return this.socket;
		}
		const socket = this.options.create();
		this.socket = socket;
		socket.addEventListener("open", () => {
			if (this.socket !== socket) return;
			const reconnecting = this.hasConnected;
			this.hasConnected = true;
			this.attempts = 0;
			const queued = this.pending.splice(0);
			if (reconnecting) {
				// The server forgot this page; introduce it again and reopen the chat.
				const replay = [this.readyMessage, this.attachMessage].filter(
					(message): message is WebviewInboundMessage =>
						message !== undefined &&
						!queued.some((item) => item.type === message.type),
				);
				for (const message of replay) socket.send(JSON.stringify(message));
			}
			for (const message of queued) socket.send(JSON.stringify(message));
			if (reconnecting) {
				this.options.dispatch({
					type: "status",
					text: "Reconnected to the Cline Hub server.",
				});
			}
		});
		socket.addEventListener("message", (event) => {
			if (this.socket !== socket) return;
			try {
				this.options.dispatch(
					JSON.parse(String(event.data)) as WebviewOutboundMessage,
				);
			} catch {
				this.options.dispatch({
					type: "error",
					text: "Received an invalid message from the Cline Hub server.",
				});
			}
		});
		// A failed connection is always followed by "close", which retries; it
		// is not reported as a chat error.
		socket.addEventListener("error", () => {});
		socket.addEventListener("close", () => {
			if (this.socket !== socket) return;
			this.socket = undefined;
			// Commands sent before the drop get no answer; callers are told
			// below. Replaying them later could repeat an action twice.
			this.pending = this.pending.filter(
				(message) => message.type !== "desktopCommand",
			);
			this.options.dispatch({
				type: "status",
				text: "Disconnected from the Cline Hub server.",
			});
			this.scheduleReconnect();
		});
		return socket;
	}

	private scheduleReconnect(): void {
		this.cancelReconnect();
		const delay =
			RECONNECT_DELAYS_MS[
				Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)
			] ?? 10_000;
		this.attempts += 1;
		const setTimer = this.options.setTimer ?? setTimeout;
		this.reconnectTimer = setTimer(() => {
			this.reconnectTimer = undefined;
			this.connect();
		}, delay);
	}

	private cancelReconnect(): void {
		if (!this.reconnectTimer) return;
		(this.options.clearTimer ?? clearTimeout)(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}
}
