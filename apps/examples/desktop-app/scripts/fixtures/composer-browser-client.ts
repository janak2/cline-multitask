import type { Provider } from "../../webview/lib/provider-schema";

const models = [
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		supportsReasoning: true,
		supportsAttachments: true,
	},
	{
		id: "gpt-5.5-long",
		name: "GPT-5.5 with a longer model name",
		supportsReasoning: true,
	},
];
const provider: Provider = {
	id: "openai-codex",
	name: "OpenAI ChatGPT Subscription",
	models: models.length,
	color: "#000000",
	letter: "O",
	enabled: true,
	configured: true,
	modelList: models,
};

export const desktopClient = {
	async invoke(command: string) {
		switch (command) {
			case "list_provider_catalog":
				return { providers: [provider], settingsPath: "" };
			case "list_provider_models":
				return { providerId: provider.id, models };
			case "list_user_instruction_configs":
				return { runtimeCommands: [] };
			case "list_plugin_commands":
				return { status: "ready", commands: [] };
			default:
				throw new Error(`Unexpected browser fixture command: ${command}`);
		}
	},
	subscribe: () => () => {},
};

export function writeDesktopDebugLog() {}
