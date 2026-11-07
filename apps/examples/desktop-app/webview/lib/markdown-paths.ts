export function resolveMarkdownPath(
	documentPath: string,
	root: string,
	reference: string,
): string | null {
	let value: string;
	try {
		value = decodeURIComponent(reference.split(/[?#]/, 1)[0] ?? "");
	} catch {
		return null;
	}
	if (
		!value ||
		Array.from(value).some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		) ||
		/^[a-z][a-z\d+.-]*:/i.test(value) ||
		/^[\\/]/.test(value)
	)
		return null;
	const normalize = (path: string) =>
		path.replace(/\\/g, "/").replace(/\/$/, "");
	const base = normalize(root);
	const parent = normalize(documentPath).split("/").slice(0, -1);
	for (const part of value.replace(/\\/g, "/").split("/")) {
		if (part === "." || !part) continue;
		if (part === "..") parent.pop();
		else parent.push(part);
	}
	const path = parent.join("/");
	return path.startsWith(`${base}/`) ? path : null;
}
