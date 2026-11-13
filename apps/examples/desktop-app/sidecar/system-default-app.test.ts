import { describe, expect, it } from "vitest";
import { opensInSystemDefaultApp } from "./system-default-app";

describe("opensInSystemDefaultApp", () => {
	it("sends documents and media to the default app, code to an editor", () => {
		expect(opensInSystemDefaultApp("/repo/report.pdf")).toBe(true);
		expect(opensInSystemDefaultApp("/repo/Report.PDF")).toBe(true);
		expect(opensInSystemDefaultApp("/repo/sheet.png")).toBe(true);
		expect(opensInSystemDefaultApp("/repo/notes.docx")).toBe(true);
		expect(opensInSystemDefaultApp("/repo/src/app.ts")).toBe(false);
		expect(opensInSystemDefaultApp("/repo/README.md")).toBe(false);
		expect(opensInSystemDefaultApp("/repo/Makefile")).toBe(false);
	});
});
