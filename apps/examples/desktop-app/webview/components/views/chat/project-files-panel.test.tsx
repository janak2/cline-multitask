// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FileViewStateProvider,
	fileViewStorageKey,
} from "@/lib/file-view-state";
import type { SessionFileDiff } from "@/lib/session-diff";
import { ProjectFilesPanel } from "./project-files-panel";

const { invokeMock, sourceControlState } = vi.hoisted(() => {
	const sourceControlState = {
		environmentId: "local",
		root: "/repo",
		branch: "main",
		hasUpstream: true,
		ahead: 1,
		behind: 0,
		staged: [{ path: "src/app.ts", status: "M", additions: 3, deletions: 1 }],
		unstaged: [{ path: "README.md", status: "M", additions: 1, deletions: 0 }],
		untracked: [{ path: "notes.txt", status: "?", additions: 2, deletions: 0 }],
		commits: [
			{
				sha: "a",
				shortSha: "aaaaaaa",
				subject: "Latest work",
				relativeDate: "2 minutes ago",
				pushed: false,
			},
			{
				sha: "b",
				shortSha: "bbbbbbb",
				subject: "Earlier work",
				relativeDate: "1 day ago",
				pushed: true,
			},
		],
	};
	const invokeMock = vi.fn(
		async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case "list_project_entries":
					return args?.path === "/repo"
						? {
								entries: [
									{ name: "src", path: "/repo/src", kind: "directory" },
									{ name: "README.md", path: "/repo/README.md", kind: "file" },
								],
								truncated: false,
							}
						: {
								entries: [
									{ name: "app.ts", path: "/repo/src/app.ts", kind: "file" },
								],
								truncated: false,
							};
				case "read_project_file":
					return { content: `// ${args?.path}\n`, truncated: false };
				case "get_source_control_state":
					// A fresh object per call, as the transport would deliver.
					return { ...sourceControlState };
				case "get_git_file_diff":
					return {
						oldText: `old ${args?.path}`,
						newText: `new ${args?.path}`,
						binary: false,
					};
				case "run_source_control_action":
					return { environmentId: "local" };
				case "get_commit_details":
					return {
						files: [
							{ path: "src/app.ts", status: "M", additions: 4, deletions: 2 },
						],
					};
				default:
					return null;
			}
		},
	);
	return { invokeMock, sourceControlState };
});

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

vi.mock("./pdf-viewer", () => ({
	PdfViewer: ({ path }: { path: string }) => (
		<div data-testid="pdf-preview">{path}</div>
	),
}));

// Plain rendering keeps shiki out of jsdom; highlighted-code.test.tsx covers
// the highlighter wiring.
vi.mock("@cline/ui/components/markdown", async (original) => ({
	...(await original<typeof import("@cline/ui/components/markdown")>()),
	markdownCodeHighlighter: {
		supportsLanguage: () => false,
		getThemes: () => ["github-light", "github-dark"],
		highlight: () => null,
	},
}));

const fileDiffs: SessionFileDiff[] = [
	{
		path: "src/app.ts",
		additions: 3,
		deletions: 1,
		hunks: [{ oldStart: 1, newStart: 1, old: "a", new: "b" }],
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (!("ResizeObserver" in globalThis)) {
		Object.assign(globalThis, {
			ResizeObserver: class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		});
	}
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockClear();
	window.localStorage.clear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function render(
	onClose = vi.fn(),
	onPickFolder?: () => Promise<string | null>,
) {
	await act(async () => {
		root.render(
			<ProjectFilesPanel
				cwd="/repo"
				environmentId="local"
				fileDiffs={fileDiffs}
				onClose={onClose}
				onPickFolder={onPickFolder}
				workspaceRoot="/repo"
			/>,
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
}

async function renderSession(
	sessionId: string,
	workspaceRoot = "/repo",
	environmentId = "local",
) {
	const key = fileViewStorageKey(
		environmentId,
		sessionId,
		workspaceRoot,
		workspaceRoot,
	);
	await act(async () => {
		root.render(
			<FileViewStateProvider value={key}>
				<ProjectFilesPanel
					key={key}
					cwd={workspaceRoot}
					environmentId={environmentId}
					workspaceRoot={workspaceRoot}
					fileDiffs={fileDiffs}
					onClose={() => {}}
				/>
			</FileViewStateProvider>,
		);
	});
}

it("restores A's file tabs, selection, expanded folders, mode and width after B and remount", async () => {
	await renderSession("A");
	await act(async () => button(/^Files$/).click());
	await act(async () => button(/^src$/).click());
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[data-entry-path="/repo/src/app.ts"]')!
			.click(),
	);
	const key = fileViewStorageKey("local", "A", "/repo", "/repo");
	const saved = JSON.parse(window.localStorage.getItem(key!)!);
	window.localStorage.setItem(key!, JSON.stringify({ ...saved, width: 510 }));
	await renderSession("B");
	expect(container.textContent).not.toContain("// /repo/src/app.ts");
	await act(async () => root.render(null));
	await renderSession("A");
	expect(container.textContent).toContain("// /repo/src/app.ts");
	expect(
		container.querySelector('[data-entry-path="/repo/src/app.ts"]'),
	).not.toBeNull();
	expect(
		container.querySelector<HTMLElement>("#project-files-panel")?.style.width,
	).toBe("510px");
});

it("does not share saved tabs with a changed workspace or environment", async () => {
	await renderSession("A");
	await act(async () => button(/^Files$/).click());
	await act(async () => button(/^README\.md/).click());
	await renderSession("A", "/other");
	expect(container.textContent).not.toContain("// /repo/README.md");
	await renderSession("A", "/repo", "ssh:other");
	expect(container.textContent).not.toContain("// /repo/README.md");
});

it("keeps missing restored files as safe read errors without replacing the selection", async () => {
	await renderSession("A");
	await act(async () => button(/^Files$/).click());
	await act(async () => button(/^README\.md/).click());
	await renderSession("B");
	const previous = invokeMock.getMockImplementation()!;
	invokeMock.mockImplementation(async (command, args) => {
		if (command === "read_project_file")
			throw new Error("File no longer exists");
		return previous(command, args);
	});
	await renderSession("A");
	expect(container.textContent).toContain("File no longer exists");
	expect(container.textContent).toContain("README.md");
	invokeMock.mockImplementation(previous);
});

it("does not auto-open a change again after the user closes all tabs", async () => {
	await renderSession("A");
	await act(async () => byLabel("Close app.ts").click());
	await renderSession("B");
	await renderSession("A");
	expect(container.querySelector("[data-tab-id]")).toBeNull();
});

it("shows a restored missing workspace error and preserves its configured root", async () => {
	await renderSession("A");
	await act(async () => button(/^Files$/).click());
	await renderSession("B");
	const previous = invokeMock.getMockImplementation()!;
	invokeMock.mockImplementation(async (command, args) => {
		if (command === "list_project_entries")
			throw new Error("Workspace no longer exists");
		return previous(command, args);
	});
	try {
		await renderSession("A");
		expect(container.textContent).toContain("Workspace no longer exists");
	} finally {
		invokeMock.mockImplementation(previous);
	}
});

function button(
	name: RegExp,
	scope: ParentNode = container,
): HTMLButtonElement {
	const match = Array.from(scope.querySelectorAll("button")).find((el) =>
		name.test(el.textContent ?? ""),
	);
	if (!match) throw new Error(`No button matching ${name}`);
	return match;
}

function byLabel(label: string, scope: ParentNode = document): HTMLElement {
	const match = scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!match) throw new Error(`No element labelled ${label}`);
	return match;
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

function allActionCalls(): Array<{ type: string }> {
	return invokeMock.mock.calls
		.filter(([command]) => command === "run_source_control_action")
		.map(([, args]) => (args as { action: { type: string } }).action);
}

/** Actions the user triggered; the panel's background fetches are excluded. */
function actionCalls() {
	return allActionCalls().filter((action) => action.type !== "fetch");
}

function fetchCount() {
	return allActionCalls().filter((action) => action.type === "fetch").length;
}

describe("ProjectFilesPanel source control view", () => {
	it("opens on Git with staged, unstaged, untracked, and commits", async () => {
		await render();
		const views = Array.from(
			container.querySelectorAll('[role="tab"]'),
			(tab) => [tab.textContent, tab.getAttribute("aria-selected")],
		);
		expect(views).toEqual([
			["Git", "true"],
			["Files", "false"],
		]);
		const column = container.querySelector("#source-control-column");
		expect(column).not.toBeNull();
		const text = column?.textContent ?? "";
		expect(text).toContain("Staged changes");
		expect(text).toContain("app.ts");
		expect(text).toContain("README.md");
		expect(text).toContain("notes.txt");
		expect(text).toContain("Latest work");
		// Committing, pushing, and pulling are left to the agent; the branch
		// line still reports how far the branch is ahead.
		expect(container.querySelector('[aria-label="Commit message"]')).toBeNull();
		for (const label of ["Push", "Pull", "Publish branch"]) {
			expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
		}
		expect(
			Array.from(column?.querySelectorAll("button") ?? []).some((el) =>
				/^Commit$/.test(el.textContent ?? ""),
			),
		).toBe(false);
		expect(text).toMatch(/main\s*1/);
		// Session-touched rows carry the marker.
		expect(
			column?.querySelector('[title="Changed in this session"]'),
		).not.toBeNull();
	});

	it("opens a staged change as a staged diff and a worktree change as a worktree diff", async () => {
		await render();
		await click(button(/^app\.ts/));
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "src/app.ts", staged: true }),
		);
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toMatch(/old src\/app\.ts.*new src\/app\.ts/);
		expect(container.textContent).toContain("staged");

		await click(button(/^README\.md/));
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "README.md", staged: false }),
		);
		// The File toggle still shows the working copy.
		await click(button(/^file$/i));
		expect(
			container.querySelector('[data-testid="markdown-file-viewer"]')
				?.textContent,
		).toContain("/repo/README.md");
	});

	it("stages and unstages through the sidecar", async () => {
		await render();
		await click(byLabel("Stage README.md"));
		expect(actionCalls()).toContainEqual({
			type: "stage",
			paths: ["README.md"],
		});
		await click(byLabel("Unstage all"));
		expect(actionCalls()).toContainEqual({
			type: "unstage",
			paths: ["src/app.ts"],
		});
	});

	it("opens the first change when the panel opens, once", async () => {
		await render();
		// Staged changes come first in the list, so the staged app.ts opens.
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "src/app.ts", staged: true }),
		);
		expect(
			container.querySelector('[aria-label="Close app.ts"]'),
		).not.toBeNull();
		expect(container.textContent).not.toContain("Select a change to review it");
		// Closing it leaves the viewer empty; later snapshots do not reopen it.
		await click(byLabel("Close app.ts", container));
		await click(byLabel("Unstage all", container));
		expect(container.querySelector('[aria-label="Close app.ts"]')).toBeNull();
		expect(container.textContent).toContain("Select a change to review it");
	});

	it("expands a commit and opens one of its files as a commit diff", async () => {
		await render();
		await click(button(/Latest work/));
		expect(invokeMock).toHaveBeenCalledWith(
			"get_commit_details",
			expect.objectContaining({ commit: "a" }),
		);
		const commitFile = Array.from(
			container.querySelectorAll("#source-control-column button"),
		).find(
			(el) =>
				el.getAttribute("title") === "src/app.ts" &&
				/\+4/.test(el.textContent ?? ""),
		);
		expect(commitFile).toBeDefined();
		await click(commitFile as Element);
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "src/app.ts", commit: "a" }),
		);
		// A commit diff has no File/Diff toggle or index actions, and its tab
		// is separate from the working-copy tab for the same file.
		expect(container.querySelector('[aria-label="Stage file"]')).toBeNull();
		expect(container.querySelector('[aria-label="Unstage file"]')).toBeNull();
		expect(
			Array.from(container.querySelectorAll("button")).some((el) =>
				/^file$/i.test(el.textContent ?? ""),
			),
		).toBe(false);
		await click(button(/^app\.ts/));
		expect(
			container.querySelectorAll('[aria-label="Close app.ts"]'),
		).toHaveLength(2);
		// Collapsing and re-expanding reuses the loaded file list.
		await click(button(/Latest work/));
		await click(button(/Latest work/));
		expect(
			invokeMock.mock.calls.filter(
				([command]) => command === "get_commit_details",
			),
		).toHaveLength(1);
	});

	it("reloads the folders expanded by the time an action finishes", async () => {
		await render();
		const listings = () =>
			invokeMock.mock.calls.filter(
				([command]) => command === "list_project_entries",
			).length;
		// Hold a stage open and expand a folder while it runs.
		let finishAction: (value: unknown) => void = () => {};
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishAction = resolve;
				}),
		);
		await click(byLabel("Stage README.md", container));
		await click(button(/^Files$/));
		await click(button(/^src/));
		const before = listings();
		await act(async () => {
			finishAction({ environmentId: "local" });
			await Promise.resolve();
		});
		// Root and the newly expanded src both list again, and src keeps
		// its children on screen.
		expect(listings()).toBe(before + 2);
		expect(container.textContent).toContain("app.ts");
	});

	it("fetches on open, every minute while open, and stops when closed", async () => {
		vi.useFakeTimers();
		try {
			await render();
			expect(fetchCount()).toBe(1);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(60_000);
			});
			expect(fetchCount()).toBe(2);
			await act(async () => root.unmount());
			root = createRoot(container);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(180_000);
			});
			expect(fetchCount()).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("runs a user action only after an in-flight fetch finishes", async () => {
		let finishFetch: (value: unknown) => void = () => {};
		const fallback = invokeMock.getMockImplementation();
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				const action = (args as { action?: { type?: string } })?.action;
				if (
					command === "run_source_control_action" &&
					action?.type === "fetch"
				) {
					return new Promise((resolve) => {
						finishFetch = resolve;
					});
				}
				return fallback?.(command, args);
			},
		);
		try {
			await render();
			expect(fetchCount()).toBe(1);
			await click(byLabel("Stage README.md", container));
			expect(actionCalls()).toEqual([]);
			await act(async () => {
				finishFetch({ environmentId: "local" });
				await Promise.resolve();
			});
			expect(actionCalls()).toContainEqual({
				type: "stage",
				paths: ["README.md"],
			});
		} finally {
			invokeMock.mockImplementation(fallback as never);
		}
	});

	it("does not fetch a branch without an upstream", async () => {
		const previous = { ...sourceControlState };
		Object.assign(sourceControlState, { hasUpstream: false, ahead: 0 });
		try {
			await render();
			expect(fetchCount()).toBe(0);
		} finally {
			Object.assign(sourceControlState, previous);
		}
	});

	it("restarts a diff read after closing the tab mid-flight", async () => {
		await render();
		invokeMock.mockImplementationOnce(() => new Promise(() => {}));
		await click(button(/^README\.md/));
		await click(byLabel("Close README.md", container));
		await click(button(/^README\.md/));
		const diffReads = invokeMock.mock.calls.filter(
			([command, args]) =>
				command === "get_git_file_diff" &&
				(args as { path?: string }).path === "README.md",
		);
		expect(diffReads).toHaveLength(2);
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toContain("new README.md");
	});

	it("confirms before discarding and splits untracked paths", async () => {
		await render();
		await click(byLabel("Discard all changes"));
		expect(actionCalls()).toEqual([]);
		expect(document.body.textContent).toContain("Discard changes to 2 files?");
		await click(button(/^Discard$/, document.body));
		expect(actionCalls()).toContainEqual({
			type: "discard",
			paths: ["README.md"],
			untrackedPaths: ["notes.txt"],
		});
	});
});

describe("unstagePaths", () => {
	it("includes the original path of a staged rename", async () => {
		const { unstagePaths } = await import("@/hooks/use-source-control");
		expect(
			unstagePaths([
				{
					path: "new.ts",
					originalPath: "old.ts",
					status: "R",
					additions: 0,
					deletions: 0,
				},
				{ path: "a.ts", status: "M", additions: 1, deletions: 0 },
			]),
		).toEqual(["new.ts", "old.ts", "a.ts"]);
	});
});

describe("ProjectFilesPanel polling", () => {
	function withHeldCommand(name: string) {
		const fallback = invokeMock.getMockImplementation();
		const resolvers: Array<(value: unknown) => void> = [];
		let calls = 0;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === name) {
					calls++;
					return new Promise((resolve) => {
						resolvers.push((value) =>
							resolve(value ?? fallback?.(command, args)),
						);
					});
				}
				return fallback?.(command, args);
			},
		);
		return {
			calls: () => calls,
			resolveAll: () => {
				for (const resolve of resolvers.splice(0)) resolve(undefined);
			},
			restore: () => invokeMock.mockImplementation(fallback as never),
		};
	}

	it("lets a status read slower than the poll land, then re-reads after an action", async () => {
		vi.useFakeTimers();
		const held = withHeldCommand("get_source_control_state");
		try {
			await render();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(15_000);
			});
			// Polls joined the pending read instead of superseding it.
			expect(held.calls()).toBe(1);
			await act(async () => {
				held.resolveAll();
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(container.textContent).toContain("Staged changes");

			// An action while a poll is pending queues one fresh read behind it.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5_000);
			});
			const before = held.calls();
			await click(byLabel("Stage README.md", container));
			await act(async () => {
				held.resolveAll();
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(held.calls()).toBe(before + 1);
		} finally {
			held.restore();
			vi.useRealTimers();
		}
	});

	it("keeps re-listing folders while git status is failing", async () => {
		vi.useFakeTimers();
		const fallback = invokeMock.getMockImplementation();
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "get_source_control_state") {
					throw new Error("index file corrupt");
				}
				return fallback?.(command, args);
			},
		);
		try {
			await render();
			await click(button(/^Files$/));
			const listings = () =>
				invokeMock.mock.calls.filter(
					([command]) => command === "list_project_entries",
				).length;
			const before = listings();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5_000);
			});
			expect(listings()).toBeGreaterThan(before);
		} finally {
			invokeMock.mockImplementation(fallback as never);
			vi.useRealTimers();
		}
	});

	it("ignores a folder listing superseded by a newer one", async () => {
		const fallback = invokeMock.getMockImplementation();
		const pending: Array<(value: unknown) => void> = [];
		let listing = 0;
		invokeMock.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "list_project_entries" && args?.path === "/repo") {
					listing++;
					if (listing === 2) {
						// Held: the stale listing from before the tree was re-shown.
						return new Promise((resolve) => pending.push(resolve));
					}
					if (listing >= 3) {
						return {
							entries: [
								{ name: "fresh.ts", path: "/repo/fresh.ts", kind: "file" },
							],
							truncated: false,
						};
					}
				}
				return fallback?.(command, args);
			},
		);
		try {
			await render();
			await click(button(/^Files$/));
			await click(button(/^Git$/));
			await click(button(/^Files$/));
			expect(container.textContent).toContain("fresh.ts");
			await act(async () => {
				pending[0]?.({
					entries: [{ name: "stale.ts", path: "/repo/stale.ts", kind: "file" }],
					truncated: false,
				});
				await Promise.resolve();
			});
			expect(container.textContent).toContain("fresh.ts");
			expect(container.textContent).not.toContain("stale.ts");
		} finally {
			invokeMock.mockImplementation(fallback as never);
		}
	});
});

describe("ProjectFilesPanel files view", () => {
	async function showFiles() {
		await click(button(/^Files$/));
	}

	it("routes image tabs to binary preview and restores them across sessions without text reads", async () => {
		const previous = invokeMock.getMockImplementation()!;
		URL.createObjectURL = vi.fn(() => "blob:panel-image");
		URL.revokeObjectURL = vi.fn();
		invokeMock.mockImplementation((async (
			command: string,
			args?: Record<string, unknown>,
		) => {
			if (command === "list_project_entries")
				return {
					entries: [
						{ name: "chart.PNG", path: "/repo/chart.PNG", kind: "file" },
					],
					truncated: false,
				};
			if (command === "read_project_image")
				return { contentBase64: btoa("fixture"), mimeType: "image/png" };
			return previous(command, args);
		}) as typeof previous);
		try {
			await renderSession("image-A");
			await showFiles();
			await click(button(/^chart\.PNG/));
			expect(container.querySelector("img")?.src).toBe("blob:panel-image");
			await renderSession("image-B");
			expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:panel-image");
			await renderSession("image-A");
			expect(container.querySelector("img")?.alt).toBe("chart.PNG");
			expect(invokeMock).toHaveBeenCalledWith("read_project_image", {
				path: "/repo/chart.PNG",
				workspaceRoot: "/repo",
				environmentId: "local",
			});
			expect(invokeMock).not.toHaveBeenCalledWith(
				"read_project_file",
				expect.objectContaining({ path: "/repo/chart.PNG" }),
			);
		} finally {
			invokeMock.mockImplementation(previous);
		}
	});

	it("routes PDFs to the document viewer without reading them as text", async () => {
		await render();
		invokeMock.mockImplementationOnce(async () => ({
			entries: [{ name: "report.PDF", path: "/repo/report.PDF", kind: "file" }],
			truncated: false,
		}));
		await showFiles();
		await click(button(/^report\.PDF/));
		expect(
			container.querySelector('[data-testid="pdf-preview"]')?.textContent,
		).toBe("/repo/report.PDF");
		expect(invokeMock).not.toHaveBeenCalledWith(
			"read_project_file",
			expect.objectContaining({ path: "/repo/report.PDF" }),
		);
	});

	it("lists the workspace root and expands folders on demand", async () => {
		await render();
		await showFiles();
		expect(container.textContent).toContain("README.md");
		// Folders load lazily: nothing under src is listed until it expands.
		expect(invokeMock).not.toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ path: "/repo/src" }),
		);
		await click(button(/^src/));
		expect(invokeMock).toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ path: "/repo/src" }),
		);
		expect(container.textContent).toContain("app.ts");
	});

	it("opens files in tabs and offers Diff for files git knows are dirty", async () => {
		await render();
		await showFiles();
		await click(button(/^README\.md/));
		expect(invokeMock).toHaveBeenCalledWith(
			"read_project_file",
			expect.objectContaining({ path: "/repo/README.md" }),
		);
		expect(
			container.querySelector('[data-testid="markdown-file-viewer"]')
				?.textContent,
		).toContain("/repo/README.md");
		const reads = invokeMock.mock.calls.filter(
			([command]) => command === "read_project_file",
		).length;
		await click(button(/^Source$/));
		expect(
			container.querySelector('[data-testid="file-contents"]'),
		).not.toBeNull();
		await click(button(/^Preview$/));
		expect(
			invokeMock.mock.calls.filter(
				([command]) => command === "read_project_file",
			),
		).toHaveLength(reads);
		// README.md is modified in the worktree, so Diff is available.
		await click(button(/^diff$/i));
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toContain("new README.md");

		await click(button(/^src/));
		await click(button(/^app\.ts/));
		expect(button(/^app\.ts/).textContent).toContain("M");
		expect(container.textContent).toContain("+3");

		// Two tabs are open; closing the active one falls back to its neighbour.
		await click(byLabel("Close app.ts", container));
		expect(container.textContent).toContain("README.md");
	});

	it("polls: open files re-read and expanded folders re-list", async () => {
		vi.useFakeTimers();
		try {
			await render();
			await showFiles();
			await click(button(/^README\.md/));
			const count = (name: string) =>
				invokeMock.mock.calls.filter(([command]) => command === name).length;
			const reads = count("read_project_file");
			const listings = count("list_project_entries");
			expect(container.querySelector('[aria-label="Refresh"]')).toBeNull();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5_000);
			});
			expect(count("read_project_file")).toBe(reads + 1);
			expect(count("list_project_entries")).toBeGreaterThan(listings);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores a read that was in flight when its tab was closed", async () => {
		await render();
		await showFiles();
		let resolveStale: (value: unknown) => void = () => {};
		// The next invoke is the README read; hold it open past the close.
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveStale = resolve;
				}),
		);
		await click(button(/^README\.md/));
		await click(byLabel("Close README.md", container));
		await act(async () => {
			resolveStale({ content: "stale contents", truncated: false });
			await Promise.resolve();
		});
		await click(button(/^README\.md/));
		expect(container.textContent).not.toContain("stale contents");
		expect(
			container.querySelector('[data-testid="markdown-file-viewer"]')
				?.textContent,
		).toContain("/repo/README.md");
	});

	it("lets a slow read finish and re-reads once afterwards", async () => {
		vi.useFakeTimers();
		try {
			await render();
			await showFiles();
			let resolveSlow: (value: unknown) => void = () => {};
			invokeMock.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveSlow = resolve;
					}),
			);
			await click(button(/^README\.md/));
			const reads = () =>
				invokeMock.mock.calls.filter(
					([command]) => command === "read_project_file",
				).length;
			expect(reads()).toBe(1);
			// A poll lands while the read is still pending.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5_000);
			});
			expect(reads()).toBe(1);
			await act(async () => {
				resolveSlow({ content: "slow contents", truncated: false });
				await Promise.resolve();
			});
			// The late response is kept, then one follow-up read refreshes it.
			expect(reads()).toBe(2);
			expect(
				container.querySelector('[data-testid="markdown-file-viewer"]')
					?.textContent,
			).toContain("/repo/README.md");
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes from its own header button", async () => {
		const onClose = vi.fn();
		await render(onClose);
		await click(byLabel("Hide project files", container));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("ProjectFilesPanel file changes", () => {
	beforeEach(() => window.localStorage.clear());

	async function showFiles() {
		await click(button(/^Files$/));
	}

	async function flush() {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	}

	async function dispatch(element: Element, event: Event) {
		await act(async () => {
			element.dispatchEvent(event);
			await Promise.resolve();
		});
	}

	function menuItem(text: string): HTMLElement {
		const match = Array.from(
			document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		).find((item) => item.textContent?.includes(text));
		if (!match) throw new Error(`No menu item ${text}`);
		return match;
	}

	async function openContextMenu(element: Element) {
		await dispatch(
			element,
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				button: 2,
			}),
		);
	}

	async function typeName(value: string) {
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="Name"]',
		);
		if (!input) throw new Error("No name input");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	async function drop(element: Element, dataTransfer: object) {
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
		await dispatch(element, event);
		await flush();
	}

	it("creates an empty file inside the right-clicked folder without overwriting", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^src/));
		await click(menuItem("New file"));
		expect(button(/^Create$/, document).disabled).toBe(true);
		await typeName("notes.txt");
		invokeMock.mockClear();
		await click(button(/^Create$/, document));
		expect(invokeMock).toHaveBeenCalledWith("write_project_file", {
			environmentId: "local",
			workspaceRoot: "/repo",
			path: "/repo/src/notes.txt",
			contentBase64: "",
			overwrite: false,
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ path: "/repo/src" }),
		);
	});

	it("cancels creating a file without writing anything", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^README\.md/));
		await click(menuItem("New file"));
		await typeName("notes.txt");
		await click(button(/^Cancel$/, document));
		expect(invokeMock).not.toHaveBeenCalledWith(
			"write_project_file",
			expect.anything(),
		);
	});

	it("creates a folder inside the right-clicked folder", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^src/));
		await click(menuItem("New folder"));
		await typeName("docs");
		await click(button(/^Create$/, document));
		expect(invokeMock).toHaveBeenCalledWith(
			"create_project_directory",
			expect.objectContaining({
				workspaceRoot: "/repo",
				path: "/repo/src/docs",
			}),
		);
	});

	it("renames an entry within its folder", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^README\.md/));
		await click(menuItem("Rename"));
		await typeName("NOTES.md");
		await click(button(/^Rename$/, document));
		expect(invokeMock).toHaveBeenCalledWith(
			"move_project_entry",
			expect.objectContaining({
				path: "/repo/README.md",
				to: "/repo/NOTES.md",
			}),
		);
	});

	it("deletes only after confirmation", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^README\.md/));
		await click(menuItem("Delete"));
		expect(invokeMock).not.toHaveBeenCalledWith(
			"delete_project_entry",
			expect.anything(),
		);
		expect(document.body.textContent).toContain("Delete README.md?");
		await click(button(/^Delete$/, document));
		expect(invokeMock).toHaveBeenCalledWith(
			"delete_project_entry",
			expect.objectContaining({ path: "/repo/README.md" }),
		);
	});

	it("moves a dragged row into the folder it is dropped on", async () => {
		await render();
		await showFiles();
		await drop(button(/^src/), {
			types: ["application/x-cline-project-path"],
			getData: () => "/repo/README.md",
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"move_project_entry",
			expect.objectContaining({
				path: "/repo/README.md",
				to: "/repo/src/README.md",
			}),
		);
	});

	it("rejects external directories without navigation, root replacement or losing tree interaction", async () => {
		await renderSession("drop-session");
		await showFiles();
		const outer = vi.fn();
		document.body.addEventListener("drop", outer);
		const getAsFile = vi.fn(() => {
			throw new Error("Directory must not be read as a file");
		});
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", {
			value: {
				types: ["Files", "text/uri-list"],
				getData: () => "",
				items: [
					{
						kind: "file",
						webkitGetAsEntry: () => ({ isDirectory: true }),
						getAsFile,
					},
				],
			},
		});
		await dispatch(button(/^src/), event);
		expect(event.defaultPrevented).toBe(true);
		expect(outer).not.toHaveBeenCalled();
		document.body.removeEventListener("drop", outer);
		expect(getAsFile).not.toHaveBeenCalled();
		expect(invokeMock).not.toHaveBeenCalledWith(
			"move_project_entry",
			expect.anything(),
		);
		expect(byLabel("Project folder", container).getAttribute("title")).toBe(
			"/repo",
		);
		await click(button(/^src/));
		expect(
			container.querySelector('[data-entry-path="/repo/src/app.ts"]'),
		).not.toBeNull();
		await renderSession("other");
		await renderSession("drop-session");
		expect(byLabel("Project folder", container).getAttribute("title")).toBe(
			"/repo",
		);
	});

	it("claims URI-only directory drops on the tree and panel header to prevent browser navigation", async () => {
		await render();
		await showFiles();
		invokeMock.mockImplementationOnce(
			async () => ({ files: [], skippedDirectories: true }) as never,
		);
		for (const target of [
			button(/^src/),
			container.querySelector("#project-files-panel")!,
		]) {
			const event = new Event("drop", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "dataTransfer", {
				value: {
					types: ["text/uri-list"],
					getData: () => "file:///external/folder",
					items: [],
				},
			});
			await dispatch(target, event);
			expect(event.defaultPrevented).toBe(true);
		}
		expect(byLabel("Project folder", container).getAttribute("title")).toBe(
			"/repo",
		);
	});

	it("imports Linux URI-list files through the trusted reader and preserves source-copy semantics", async () => {
		await render();
		await showFiles();
		const previous = invokeMock.getMockImplementation()!;
		invokeMock.mockImplementation(async (command, args) =>
			command === "read_dropped_project_files"
				? ({
						files: [{ name: "external.txt", contentBase64: "aGk=" }],
						skippedDirectories: false,
					} as never)
				: previous(command, args),
		);
		try {
			const transfer = {
				types: ["text/uri-list"],
				getData: (type: string) =>
					type === "text/uri-list" ? "file:///external/external.txt" : "",
				items: [],
				dropEffect: "none",
			};
			const over = new Event("dragover", { bubbles: true, cancelable: true });
			Object.defineProperty(over, "dataTransfer", { value: transfer });
			await dispatch(button(/^src/), over);
			expect(transfer.dropEffect).toBe("copy");
			await drop(button(/^src/), transfer);
			await flush();
			expect(invokeMock).toHaveBeenCalledWith(
				"read_dropped_project_files",
				expect.objectContaining({ uriList: "file:///external/external.txt" }),
			);
			expect(invokeMock).toHaveBeenCalledWith(
				"write_project_file",
				expect.objectContaining({
					path: "/repo/src/external.txt",
					contentBase64: "aGk=",
					overwrite: false,
				}),
			);
		} finally {
			invokeMock.mockImplementation(previous);
		}
	});

	it("imports FileList-only external files when WebKit exposes no DataTransfer items", async () => {
		await render();
		await showFiles();
		await drop(button(/^src/), {
			types: ["Files"],
			getData: () => "",
			items: [],
			files: [new File(["hi"], "external.txt")],
		});
		await flush();
		expect(invokeMock).toHaveBeenCalledWith(
			"write_project_file",
			expect.objectContaining({
				path: "/repo/src/external.txt",
				contentBase64: "aGk=",
				overwrite: false,
			}),
		);
	});

	it("confirms URI-list name conflicts before importing and ignores results after switching sessions", async () => {
		await renderSession("A");
		await showFiles();
		const previous = invokeMock.getMockImplementation()!;
		let finish: ((result: unknown) => void) | undefined;
		invokeMock.mockImplementation(async (command, args) =>
			command === "read_dropped_project_files"
				? ((await new Promise((resolve) => {
						finish = resolve;
					})) as never)
				: previous(command, args),
		);
		const transfer = {
			types: ["text/uri-list"],
			getData: (type: string) =>
				type === "text/uri-list" ? "file:///external/README.md" : "",
			items: [],
		};
		try {
			await drop(button(/^README\.md/), transfer);
			await act(async () =>
				finish?.({
					files: [{ name: "README.md", contentBase64: "aGk=" }],
					skippedDirectories: false,
				}),
			);
			expect(document.body.textContent).toContain("Replace README.md?");
			expect(invokeMock).not.toHaveBeenCalledWith(
				"write_project_file",
				expect.anything(),
			);
			await click(button(/^Cancel$/, document));
			await drop(button(/^README\.md/), transfer);
			await renderSession("B");
			await act(async () =>
				finish?.({
					files: [{ name: "README.md", contentBase64: "aGk=" }],
					skippedDirectories: false,
				}),
			);
			expect(document.body.textContent).not.toContain("Replace README.md?");
			expect(invokeMock).not.toHaveBeenCalledWith(
				"write_project_file",
				expect.anything(),
			);
		} finally {
			invokeMock.mockImplementation(previous);
		}
	});

	it("disables native paste/reveal remotely and still prevents external drop navigation", async () => {
		await renderSession("remote", "/repo", "ssh:host");
		await showFiles();
		await openContextMenu(button(/^src/));
		expect(
			menuItem("Paste files and folders").getAttribute("aria-disabled"),
		).toBe("true");
		expect(
			menuItem("Open Containing Folder").getAttribute("aria-disabled"),
		).toBe("true");
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", {
			value: { types: ["text/uri-list"], getData: () => "", items: [] },
		});
		await dispatch(container.querySelector("#project-files-panel")!, event);
		expect(event.defaultPrevented).toBe(true);
		expect(invokeMock).not.toHaveBeenCalledWith(
			"paste_project_entries",
			expect.anything(),
		);
	});

	it("pastes into folder rows, file parents and background; opens containing folders without changing root", async () => {
		await render();
		await showFiles();
		await openContextMenu(button(/^src/));
		await click(menuItem("Paste files and folders"));
		expect(invokeMock).toHaveBeenCalledWith(
			"paste_project_entries",
			expect.objectContaining({ path: "/repo/src", workspaceRoot: "/repo" }),
		);
		await openContextMenu(button(/^README\.md/));
		await click(menuItem("Paste files and folders"));
		expect(invokeMock).toHaveBeenCalledWith(
			"paste_project_entries",
			expect.objectContaining({ path: "/repo" }),
		);
		await openContextMenu(button(/^README\.md/));
		await click(menuItem("Open Containing Folder"));
		expect(invokeMock).toHaveBeenCalledWith(
			"open_containing_project_folder",
			expect.objectContaining({ path: "/repo/README.md" }),
		);
		await openContextMenu(byLabel("Project folder", container).parentElement!);
		await click(menuItem("Open Folder in File Manager"));
		expect(invokeMock).toHaveBeenCalledWith(
			"open_containing_project_folder",
			expect.objectContaining({ path: "/repo" }),
		);
	});

	it("asks before a file dropped from the system replaces one", async () => {
		await render();
		await showFiles();
		await drop(button(/^README\.md/), {
			types: ["Files"],
			getData: () => "",
			items: [
				{
					kind: "file",
					getAsFile: () => new File(["hi"], "README.md"),
					webkitGetAsEntry: () => ({ isDirectory: false }),
				},
			],
		});
		expect(invokeMock).not.toHaveBeenCalledWith(
			"write_project_file",
			expect.anything(),
		);
		expect(document.body.textContent).toContain("Replace README.md?");
		await click(button(/^Replace$/, document));
		await flush();
		expect(invokeMock).toHaveBeenCalledWith(
			"write_project_file",
			expect.objectContaining({
				path: "/repo/README.md",
				contentBase64: "aGk=",
				overwrite: true,
			}),
		);
	});

	it("adds, switches to and removes project folders from the dropdown", async () => {
		const onPickFolder = vi.fn(async () => "/other");
		await render(vi.fn(), onPickFolder);
		await showFiles();
		const trigger = byLabel("Project folder", container);
		await dispatch(
			trigger,
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
		await click(menuItem("Add folder"));
		await flush();
		expect(invokeMock).toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ workspaceRoot: "/other", path: "/other" }),
		);
		expect(trigger.textContent).toBe("other");

		await dispatch(
			trigger,
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
		await click(byLabel("Remove other"));
		expect(document.body.textContent).toContain(
			"Files on disk are not deleted.",
		);
		await click(button(/^Remove$/, document));
		expect(trigger.textContent).toBe("repo");
		expect(window.localStorage.getItem("cline.code.project-folders.v1")).toBe(
			"{}",
		);
	});
});
