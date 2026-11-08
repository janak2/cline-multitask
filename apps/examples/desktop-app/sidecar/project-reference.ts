import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

export function validateLocalProjectReference(
	root: string,
	path: string,
): string {
	try {
		const resolved = realpathSync(path);
		const rel = relative(realpathSync(root), resolved);
		if (
			rel === ".." ||
			rel.startsWith("../") ||
			rel.startsWith("..\\") ||
			isAbsolute(rel)
		)
			throw new Error("Unsafe link blocked: target is outside the workspace");
		if (!statSync(resolved).isFile())
			throw new Error("Unsupported link target: not a file");
		return resolved;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error.code === "ENOENT" || error.code === "ENOTDIR")
		)
			throw new Error("Linked file is missing");
		throw error;
	}
}
