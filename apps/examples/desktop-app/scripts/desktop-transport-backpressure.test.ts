import { describe, expect, it } from "bun:test";
import { DESKTOP_TRANSPORT_BACKPRESSURE_LIMIT_BYTES } from "../sidecar/server";

// Several large responses queued at once (PDF previews), then a small one
// (a folder listing). Returns whether the small one reached the client.
async function sendBurst(backpressureLimit?: number): Promise<boolean> {
	const large = "x".repeat(12 * 1024 * 1024);
	const server = Bun.serve({
		port: 0,
		fetch: (request, current) =>
			current.upgrade(request) ? undefined : new Response("upgrade required"),
		websocket: {
			...(backpressureLimit === undefined ? {} : { backpressureLimit }),
			message(ws) {
				for (let index = 0; index < 4; index++) ws.send(large);
				ws.send("folder-listing");
			},
		},
	});
	try {
		const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
		return await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 2_000);
			client.onopen = () => client.send("list");
			client.onmessage = (event) => {
				if (event.data === "folder-listing") {
					clearTimeout(timer);
					resolve(true);
				}
			};
		}).finally(() => client.close());
	} finally {
		server.stop(true);
	}
}

describe("desktop transport backpressure", () => {
	it("drops a reply queued behind large previews at Bun's default limit", async () => {
		expect(await sendBurst()).toBe(false);
	});

	it("delivers that reply with the sidecar's limit", async () => {
		expect(await sendBurst(DESKTOP_TRANSPORT_BACKPRESSURE_LIMIT_BYTES)).toBe(
			true,
		);
	});
});
