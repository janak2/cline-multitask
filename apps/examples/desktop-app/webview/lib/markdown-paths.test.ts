import { expect, it } from "vitest";
import { resolveMarkdownPath } from "./markdown-paths";

it("resolves relative links from the document directory", () => {
	expect(
		resolveMarkdownPath(
			"/repo/docs/README.md",
			"/repo",
			"../images/a%20b.png#x",
		),
	).toBe("/repo/images/a b.png");
	expect(
		resolveMarkdownPath("C:\\repo\\docs\\a.md", "C:\\repo", "../b.md"),
	).toBe("C:/repo/b.md");
});
it("rejects schemes, absolute paths, encoded traversal, controls and malformed escapes", () => {
	for (const reference of [
		"../../secret",
		"%2e%2e/%2e%2e/secret",
		"/etc/passwd",
		"//host/image",
		"file:///secret",
		"javascript:alert(1)",
		"data:text/html,x",
		"%00a",
		"%zz",
		"C:\\secret",
	]) {
		expect(
			resolveMarkdownPath("/repo/docs/a.md", "/repo", reference),
		).toBeNull();
	}
});
