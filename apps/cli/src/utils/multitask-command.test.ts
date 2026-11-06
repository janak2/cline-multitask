import { describe, expect, it } from "vitest";
import {
	formatTeammateRestartWarning,
	parseMultitaskCommand,
} from "./multitask-command";

describe("parseMultitaskCommand", () => {
	it("turns the mode on with no argument or on", () => {
		expect(parseMultitaskCommand("/multitask")).toEqual({
			kind: "set",
			enabled: true,
		});
		expect(parseMultitaskCommand("  /multitask ON ")).toEqual({
			kind: "set",
			enabled: true,
		});
	});

	it("turns the mode off", () => {
		expect(parseMultitaskCommand("/multitask off")).toEqual({
			kind: "set",
			enabled: false,
		});
	});

	it("stops teammates", () => {
		expect(parseMultitaskCommand("/multitask stop")).toEqual({ kind: "stop" });
	});

	it("treats any other argument as a task", () => {
		expect(
			parseMultitaskCommand("/multitask  Add Dark mode\nto settings "),
		).toEqual({
			kind: "task",
			task: "Add Dark mode\nto settings",
		});
	});

	it("ignores other prompts", () => {
		expect(parseMultitaskCommand("/multitasking")).toEqual({ kind: "none" });
		expect(parseMultitaskCommand("run /multitask later")).toEqual({
			kind: "none",
		});
	});
});

describe("formatTeammateRestartWarning", () => {
	it("warns only while teammate runs are active", () => {
		expect(formatTeammateRestartWarning(0)).toBeUndefined();
		expect(formatTeammateRestartWarning(2)).toBe(
			"2 teammate run(s) are active. Switching restarts the session; they will be interrupted and resumed where possible.",
		);
	});
});
