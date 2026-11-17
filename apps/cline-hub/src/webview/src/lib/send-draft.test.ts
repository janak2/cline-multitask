// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	PromptInput,
	PromptInputProvider,
	usePromptInputController,
} from "../components/ai-elements/prompt-input";

describe("phone send draft", () => {
	it("keeps the draft and photo until acknowledgment succeeds, including restore failure", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		URL.createObjectURL = vi.fn(() => "blob:photo");
		URL.revokeObjectURL = vi.fn();
		let controller!: ReturnType<typeof usePromptInputController>;
		let reject!: (error: Error) => void;
		const submit = vi.fn(
			() =>
				new Promise<void>((_resolve, fail) => {
					reject = fail;
				}),
		);
		function Harness() {
			controller = usePromptInputController();
			return createElement(PromptInput, { onSubmit: submit });
		}
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		try {
			await act(async () =>
				root.render(
					createElement(
						PromptInputProvider,
						{ initialInput: "Keep this draft" },
						createElement(Harness),
					),
				),
			);
			await act(async () =>
				controller.attachments.add([
					new File(["photo"], "photo.png", { type: "image/png" }),
				]),
			);
			await act(async () =>
				container
					.querySelector("form")
					?.dispatchEvent(
						new Event("submit", { bubbles: true, cancelable: true }),
					),
			);
			await act(async () => {
				await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
			});
			expect(controller.textInput.value).toBe("Keep this draft");
			expect(controller.attachments.files).toHaveLength(1);
			await act(async () => reject(new Error("Could not restore saved chat")));
			expect(controller.textInput.value).toBe("Keep this draft");
			expect(controller.attachments.files).toHaveLength(1);
			submit.mockImplementationOnce(async () => {});
			await act(async () =>
				container
					.querySelector("form")
					?.dispatchEvent(
						new Event("submit", { bubbles: true, cancelable: true }),
					),
			);
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
			});
			expect(controller.textInput.value).toBe("");
			expect(controller.attachments.files).toHaveLength(0);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	});
});
