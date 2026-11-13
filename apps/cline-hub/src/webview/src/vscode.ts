import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
} from "../../webview-protocol";
import { HubSocket } from "./lib/hub-socket";

type VsCodeApi = {
	postMessage(message: WebviewInboundMessage): void;
	getState(): unknown;
	setState(state: unknown): void;
};

declare global {
	interface Window {
		acquireVsCodeApi?: () => VsCodeApi;
	}
}

let cachedApi: VsCodeApi | undefined;
let hubSocket: HubSocket | undefined;
const stateKey = "cline-hub-webview-state";

function dispatchHostMessage(message: WebviewOutboundMessage): void {
	window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function readBrowserRoomSecret(): string | undefined {
	const roomSecret = new URLSearchParams(window.location.search)
		.get("roomSecret")
		?.trim();
	return roomSecret || undefined;
}

function browserSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const params = new URLSearchParams();
	const roomSecret = readBrowserRoomSecret();
	if (roomSecret) {
		params.set("roomSecret", roomSecret);
	}
	const query = params.toString();
	return `${protocol}//${window.location.host}/browser${query ? `?${query}` : ""}`;
}

function getHubSocket(): HubSocket {
	if (hubSocket) return hubSocket;
	const socket = new HubSocket({
		create: () => new WebSocket(browserSocketUrl()),
		dispatch: dispatchHostMessage,
	});
	hubSocket = socket;
	// Phones drop the connection while the page is in the background;
	// reconnect as soon as it is shown again instead of waiting.
	const wake = () => {
		if (document.visibilityState === "visible") socket.wake();
	};
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("pageshow", wake);
	window.addEventListener("focus", wake);
	window.addEventListener("online", wake);
	return socket;
}

function createBrowserApi(): VsCodeApi {
	return {
		postMessage(message) {
			getHubSocket().post(message);
		},
		getState() {
			try {
				const raw = window.localStorage.getItem(stateKey);
				return raw ? JSON.parse(raw) : undefined;
			} catch {
				return undefined;
			}
		},
		setState(state) {
			try {
				window.localStorage.setItem(stateKey, JSON.stringify(state ?? {}));
			} catch {
				// Browser persistence is best-effort.
			}
		},
	};
}

export function getVsCodeApi(): VsCodeApi | undefined {
	if (cachedApi) {
		return cachedApi;
	}
	if (typeof window.acquireVsCodeApi === "function") {
		cachedApi = window.acquireVsCodeApi();
		return cachedApi;
	}
	cachedApi = createBrowserApi();
	return cachedApi;
}

export function postToHost(message: WebviewInboundMessage): void {
	getVsCodeApi()?.postMessage(message);
}

export type { WebviewOutboundMessage };
