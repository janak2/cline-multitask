import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_CACHE_TTL_MS, ChatCache } from "./chat-cache";
import { sessionKey } from "./session-identity";

afterEach(() => vi.useRealTimers());

describe("ChatCache", () => {
	it("retains entries for fifteen minutes and resets expiry when saved again", () => {
		vi.useFakeTimers();
		const cache = new ChatCache<object>();
		const value = {};
		cache.set("chat", value);
		vi.advanceTimersByTime(CHAT_CACHE_TTL_MS - 1);
		expect(cache.get("chat")).toBe(value);
		cache.set("chat", value);
		vi.advanceTimersByTime(CHAT_CACHE_TTL_MS - 1);
		expect(cache.get("chat")).toBe(value);
		vi.advanceTimersByTime(1);
		expect(cache.get("chat")).toBeUndefined();
	});

	it("separates environments and bounds retained chats", () => {
		vi.useFakeTimers();
		const cache = new ChatCache<number>();
		cache.set(sessionKey({ sessionId: "same", environmentId: "local" }), 1);
		expect(
			cache.get(sessionKey({ sessionId: "same", environmentId: "ssh" })),
		).toBeUndefined();
		for (let i = 0; i < 12; i++) cache.set(String(i), i);
		expect(
			cache.get(sessionKey({ sessionId: "same", environmentId: "local" })),
		).toBeUndefined();
		cache.clear();
		expect(vi.getTimerCount()).toBe(0);
	});
});
