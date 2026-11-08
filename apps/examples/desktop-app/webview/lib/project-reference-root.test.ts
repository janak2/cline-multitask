import { expect, it } from "vitest";
import { projectReferenceRoot } from "./project-reference-root";

it("keeps the workspace boundary when browsing nested folders", () => {
	expect(
		projectReferenceRoot("/repo/docs/nested/a.md", "/repo", ["/repo/docs"]),
	).toBe("/repo");
});

it("does not confuse similarly named sibling roots", () => {
	expect(
		projectReferenceRoot("/repo-other/a.md", "/repo", ["/repo-other"]),
	).toBe("/repo-other");
	expect(
		projectReferenceRoot("C:\\repo-other\\a.md", "C:\\repo", [
			"C:\\repo-other",
		]),
	).toBe("C:\\repo-other");
});
