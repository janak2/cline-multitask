// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolMessageBlock } from "./tool-message-block";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

let container: HTMLDivElement;
let root: Root;
const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);
const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	writeText.mockReset();
	toast.mockReset();
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	if (originalClipboard)
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	else Reflect.deleteProperty(navigator, "clipboard");
});

async function renderCommand(
	running: boolean,
	output = "\u001b[32mpassed\u001b[0m\n",
) {
	await act(async () =>
		root.render(
			<ToolMessageBlock
				isRunActive={running}
				messages={[
					{
						id: "command",
						sessionId: "session",
						role: "tool",
						createdAt: 1,
						content: JSON.stringify({
							toolName: "run_commands",
							input: { commands: ["bun test", "bun run typecheck"] },
							result: running ? null : output,
						}),
						meta: running
							? {
									toolName: "run_commands",
									toolOutput: output,
									hookEventName: "tool_call_start",
								}
							: undefined,
					},
				]}
			/>,
		),
	);
}

async function click(label: string) {
	const button = container.querySelector<HTMLButtonElement>(
		`[aria-label="${label}"]`,
	);
	if (!button) throw new Error(`Missing ${label}`);
	await act(async () => button.click());
}

it.each([
	true,
	false,
])("copies commands and plain output while running=%s", async (running) => {
	await renderCommand(running);
	expect(
		container
			.querySelector(".cline-chat-tool-details")
			?.classList.contains("cline-chat-selectable"),
	).toBe(true);
	const output = container.querySelector<HTMLElement>(
		'[aria-label="Command output"]',
	);
	expect(output?.classList.contains("cline-chat-selectable")).toBe(true);
	expect(output?.tabIndex).toBe(0);
	await click("Copy command");
	expect(writeText).toHaveBeenLastCalledWith("bun test\nbun run typecheck");
	await click("Copy output");
	expect(writeText).toHaveBeenLastCalledWith("passed\n");
	expect(container.querySelectorAll('[aria-label="Copied"]')).toHaveLength(2);
});

it("copies updated live output, not an earlier snapshot", async () => {
	await renderCommand(true, "first\n");
	await renderCommand(true, "first\nsecond\n");
	await click("Copy output");
	expect(writeText).toHaveBeenCalledWith("first\nsecond\n");
});

it("reports clipboard failure without claiming success", async () => {
	writeText.mockRejectedValueOnce(new Error("denied"));
	await renderCommand(false);
	await click("Copy output");
	expect(toast).toHaveBeenCalledWith(
		expect.objectContaining({ title: "Copy failed", variant: "destructive" }),
	);
	expect(container.querySelector('[aria-label="Copied"]')).toBeNull();
});
