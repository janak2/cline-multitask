export const CHAT_CACHE_TTL_MS = 15 * 60 * 1_000;

export class ChatCache<T> {
	private entries = new Map<
		string,
		{ value: T; timer: ReturnType<typeof setTimeout> }
	>();

	get(key: string): T | undefined {
		return this.entries.get(key)?.value;
	}

	set(key: string, value: T): void {
		const existing = this.entries.get(key);
		if (existing) clearTimeout(existing.timer);
		this.entries.delete(key);
		this.entries.set(key, {
			value,
			timer: setTimeout(() => this.delete(key), CHAT_CACHE_TTL_MS),
		});
		while (this.entries.size > 12) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.delete(oldest);
		}
	}

	delete(key: string): void {
		const entry = this.entries.get(key);
		if (entry) clearTimeout(entry.timer);
		this.entries.delete(key);
	}

	clear(): void {
		for (const key of this.entries.keys()) this.delete(key);
	}
}
