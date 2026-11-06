// Phone access serves the dashboard over plain http through Tailscale Serve
// (Tailscale encrypts the traffic), and browsers hide these APIs on http pages.

if (typeof crypto.randomUUID !== "function") {
	crypto.randomUUID = () =>
		"10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
			(
				Number(digit) ^
				((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) &
					(15 >> (Number(digit) / 4)))
			).toString(16),
		) as ReturnType<Crypto["randomUUID"]>;
}

if (!navigator.clipboard) {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				const area = document.createElement("textarea");
				area.value = text;
				area.style.position = "fixed";
				area.style.opacity = "0";
				document.body.append(area);
				area.select();
				area.setSelectionRange(0, text.length);
				const copied = document.execCommand("copy");
				area.remove();
				if (!copied) throw new Error("Copy failed");
			},
		},
	});
}
