// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatSelectionToChat } from "./chat-selection-to-chat";
import { PublishedArtifacts } from "./messages/published-artifacts";
import { ToolApprovalPanel } from "./messages/tool-approval-panel";
import { ToolMessageBlock } from "./messages/tool-message-block";
import { UxVerificationMessage } from "./messages/ux-verification-message";

let container: HTMLDivElement;
let root: Root;
let styles: HTMLStyleElement;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal(
		"matchMedia",
		vi.fn((media: string) => ({
			media,
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		})),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const css = readFileSync(
		`${import.meta.dirname}/../../../app/globals.css`,
		"utf8",
	);
	styles = document.createElement("style");
	styles.textContent = [
		...css.matchAll(/([^{}]+)\{([^{}]*user-select:[^{}]*)\}/g),
	]
		.map((match) => `${match[1]}{${match[2]}}`)
		.join("\n");
	document.head.appendChild(styles);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	styles?.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function selectionStyle(element: Element | null): string {
	if (!element) throw new Error("Missing content");
	return (
		getComputedStyle(element).userSelect ||
		(element.parentElement ? selectionStyle(element.parentElement) : "auto")
	);
}

it("makes tool details, answers, errors, artifacts and approval metadata selectable inside chat", async () => {
	await act(async () =>
		root.render(
			<ChatSelectionToChat>
				<ToolMessageBlock
					isRunActive={false}
					messages={[
						{
							id: "read",
							sessionId: "session",
							role: "tool",
							createdAt: 1,
							content: JSON.stringify({
								toolName: "read_files",
								input: { files: [{ path: "/workspace/notes.txt" }] },
								result: "file body",
							}),
						},
						{
							id: "question",
							sessionId: "session",
							role: "tool",
							createdAt: 2,
							content: JSON.stringify({
								toolName: "ask_question",
								input: { question: "Which branch?" },
								result: "dev",
							}),
						},
						{
							id: "failed",
							sessionId: "session",
							role: "tool",
							createdAt: 3,
							content: JSON.stringify({
								toolName: "read_files",
								input: {},
								isError: true,
								result: "Permission denied",
							}),
						},
					]}
				/>
				<PublishedArtifacts
					sessionId="session"
					files={[
						{
							path: "/report.pdf",
							error: { code: "upload_failed", message: "Upload failed" },
						},
					]}
				/>
				<ToolApprovalPanel
					items={[
						{
							requestId: "request-1",
							sessionId: "session",
							toolCallId: "call",
							toolName: "run_commands",
							createdAt: "2026-01-01T00:00:00Z",
							iteration: 2,
							input: { command: "pwd" },
						},
					]}
					pendingActions={{}}
					requestErrors={{ "request-1": "Approval failed" }}
					onApprove={vi.fn()}
					onReject={vi.fn()}
				/>
			</ChatSelectionToChat>,
		),
	);
	for (const trigger of container.querySelectorAll<HTMLButtonElement>(
		'.cline-chat-tool-trigger[aria-expanded="false"]',
	)) {
		await act(async () => trigger.click());
	}
	for (const text of [
		"/workspace/notes.txt",
		"Which branch?",
		"Answer: dev",
		"Permission denied",
		"report.pdf",
		"Upload failed",
		"Request request-1",
		"Approval failed",
	]) {
		const element = [...container.querySelectorAll("div, span, p")].find(
			(node) =>
				!node.closest("button") &&
				node.textContent?.includes(text) &&
				![...node.children].some((child) => child.textContent?.includes(text)),
		);
		expect(element, text).toBeDefined();
		expect(selectionStyle(element ?? null), text).toBe("text");
	}
	expect(selectionStyle(container.querySelector("button"))).toBe("none");
});

it("keeps selectable content scoped to chat and preserves input and control behavior", async () => {
	const click = vi.fn();
	await act(async () =>
		root.render(
			<>
				<p data-testid="outside">Outside chat</p>
				<ChatSelectionToChat>
					<p data-testid="inside">Chat notice</p>
					<button type="button" onClick={click}>
						Approve
					</button>
					<input aria-label="Answer" />
				</ChatSelectionToChat>
			</>,
		),
	);
	expect(
		selectionStyle(container.querySelector('[data-testid="outside"]')),
	).toBe("none");
	expect(
		selectionStyle(container.querySelector('[data-testid="inside"]')),
	).toBe("text");
	expect(selectionStyle(container.querySelector("input"))).toBe("text");
	expect(selectionStyle(container.querySelector("button"))).toBe("none");
	await act(async () => container.querySelector("button")?.click());
	expect(click).toHaveBeenCalledOnce();
});

it("keeps UX verification titles and captions inside the selectable chat surface", async () => {
	await act(async () =>
		root.render(
			<ChatSelectionToChat>
				<UxVerificationMessage
					message={{
						id: "verification",
						sessionId: "session",
						role: "tool",
						createdAt: 1,
						content: JSON.stringify({
							toolName: "present_results",
							result: {
								kind: "ux_verification",
								version: 1,
								title: "Verified navigation",
								subtitle: "Desktop report",
								checks: [
									{
										id: "menu",
										title: "Menu opens",
										subtitle: "Navigation is visible",
										status: "blocked",
									},
								],
							},
						}),
					}}
				/>
			</ChatSelectionToChat>,
		),
	);
	for (const selector of ["h3", "h4", "figcaption p"]) {
		expect(selectionStyle(container.querySelector(selector))).toBe("text");
	}
});
