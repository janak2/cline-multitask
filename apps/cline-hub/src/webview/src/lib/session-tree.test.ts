import { describe, expect, it } from "vitest";
import {
	buildSessionTree,
	hasRunningDescendant,
	visibleSessionRows,
} from "./session-tree";

type Node = ReturnType<typeof buildSessionTree>[number];

function shape(nodes: Node[]): unknown[] {
	return nodes.map((node) =>
		node.children.length > 0
			? { [node.session.sessionId]: shape(node.children) }
			: node.session.sessionId,
	);
}

describe("buildSessionTree", () => {
	it("keeps root order and nests children sorted by start time", () => {
		const tree = buildSessionTree([
			{ sessionId: "lead-b", createdAt: 50 },
			{ sessionId: "child-2", parentSessionId: "lead-a", createdAt: 30 },
			{ sessionId: "lead-a", createdAt: 10 },
			{ sessionId: "child-1", parentSessionId: "lead-a", createdAt: 20 },
		]);
		expect(shape(tree)).toEqual([
			"lead-b",
			{ "lead-a": ["child-1", "child-2"] },
		]);
	});

	it("nests recursively", () => {
		const tree = buildSessionTree([
			{ sessionId: "lead" },
			{ sessionId: "child", parentSessionId: "lead" },
			{ sessionId: "grandchild", parentSessionId: "child" },
		]);
		expect(shape(tree)).toEqual([{ lead: [{ child: ["grandchild"] }] }]);
	});

	it("renders a child whose parent is missing at the top level", () => {
		const tree = buildSessionTree([
			{ sessionId: "orphan", parentSessionId: "gone" },
			{ sessionId: "lead" },
		]);
		expect(shape(tree)).toEqual(["orphan", "lead"]);
	});

	it("treats a self-referencing session as a root", () => {
		const tree = buildSessionTree([{ sessionId: "a", parentSessionId: "a" }]);
		expect(shape(tree)).toEqual(["a"]);
	});
});

describe("visibleSessionRows", () => {
	const tree = buildSessionTree([
		{ sessionId: "lead" },
		{ sessionId: "child", parentSessionId: "lead" },
		{ sessionId: "grandchild", parentSessionId: "child" },
		{ sessionId: "other" },
	]);
	const rows = (isExpanded: (node: Node) => boolean) =>
		visibleSessionRows(tree, isExpanded).map(
			(row) => `${row.depth}:${row.node.session.sessionId}`,
		);

	it("lists expanded descendants with their depth", () => {
		expect(rows(() => true)).toEqual([
			"0:lead",
			"1:child",
			"2:grandchild",
			"0:other",
		]);
	});

	it("hides the children of collapsed nodes", () => {
		expect(rows(() => false)).toEqual(["0:lead", "0:other"]);
		expect(rows((node) => node.session.sessionId === "lead")).toEqual([
			"0:lead",
			"1:child",
			"0:other",
		]);
	});
});

describe("hasRunningDescendant", () => {
	it("detects running sessions at any depth", () => {
		const [lead] = buildSessionTree([
			{ sessionId: "lead", status: "running" },
			{ sessionId: "child", parentSessionId: "lead", status: "completed" },
			{ sessionId: "grandchild", parentSessionId: "child", status: "running" },
		]);
		expect(hasRunningDescendant(lead)).toBe(true);
	});

	it("ignores the session's own status", () => {
		const [lead] = buildSessionTree([
			{ sessionId: "lead", status: "running" },
			{ sessionId: "child", parentSessionId: "lead", status: "failed" },
		]);
		expect(hasRunningDescendant(lead)).toBe(false);
	});
});
