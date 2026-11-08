import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const fromVitest = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(fromVitest.resolve("vite"));
const fromVscode = createRequire(
	new URL("../../../vscode/package.json", import.meta.url),
);
const { chromium } = fromVscode("@playwright/test");
const server = await createServer({
	configFile: false,
	root: appRoot,
	logLevel: "warn",
	esbuild: { jsx: "automatic" },
	resolve: {
		alias: [
			{
				find: "@/lib/desktop-client",
				replacement: `${appRoot}scripts/fixtures/composer-browser-client.ts`,
			},
			{ find: "@", replacement: `${appRoot}webview` },
		],
		dedupe: ["react", "react-dom"],
	},
	css: { postcss: `${appRoot}webview` },
	server: { host: "127.0.0.1", port: 0 },
	plugins: [
		{
			name: "composer-browser-fixture",
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					if (request.url !== "/") return next();
					response.setHeader("Content-Type", "text/html");
					response.end(
						'<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/composer-browser.tsx"></script></body></html>',
					);
				});
			},
		},
	],
});

let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		...(process.env.CHROME_BIN
			? { executablePath: process.env.CHROME_BIN }
			: {}),
	});
	const page = await browser.newPage({
		viewport: { width: 1400, height: 900 },
		reducedMotion: "reduce",
	});
	page.setDefaultTimeout(15_000);
	const errors = [];
	page.on("pageerror", (error) => {
		errors.push(error.message);
		console.error(error.message);
	});
	await page.route(/^(https?|wss?):\/\//, (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "127.0.0.1") return route.continue();
		return route.abort();
	});
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(
		() => !document.querySelector('[aria-label="Thinking level"]').disabled,
	);
	await page.evaluate(() => document.fonts.ready);
	const results = [];
	for (const width of [740, 620, 560, 532, 516, 514, 512, 500, 440, 360]) {
		await page.getByTestId("chat-pane").evaluate((element, width) => {
			element.style.width = `${width}px`;
		}, width);
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		const compact = await page
			.locator(".group\\/composer")
			.getAttribute("data-compact");
		const modelTrigger = compact
			? page.getByRole("button", { name: "Model and provider", exact: true })
			: page.getByRole("button", { name: /^Model:/ }).filter({ visible: true });
		const effort = page.getByRole("combobox", { name: "Thinking level" });
		const controls = [
			page.getByRole("button", { name: "Attach files", exact: true }),
			page.getByRole("group", { name: "Conversation mode" }),
			page.getByRole("button", { name: "Turn off Multitask mode" }),
			page.getByRole("button", { name: "Stop teammates (2)", exact: true }),
			modelTrigger,
			effort,
			...(!compact
				? [
						page
							.getByRole("button", { name: /^Provider:/ })
							.filter({ visible: true }),
					]
				: []),
		];
		const composer = await page.locator(".group\\/composer").boundingBox();
		const boxes = await Promise.all(
			controls.map((control) => control.boundingBox()),
		);
		for (const [index, box] of boxes.entries()) {
			assert(
				box && box.width >= 12 && box.height >= 12,
				`control ${index} visible at ${width}`,
			);
			if (index === 4 && !compact)
				assert(box.width >= 60, `model name has usable width at ${width}`);
			assert(
				box.x >= composer.x &&
					box.x + box.width <= composer.x + composer.width + 1,
				`control ${index} inside composer at ${width}`,
			);
			for (const other of boxes.slice(0, index)) {
				assert(
					box.x + box.width <= other.x + 1 ||
						other.x + other.width <= box.x + 1 ||
						box.y + box.height <= other.y + 1 ||
						other.y + other.height <= box.y + 1,
					`control ${index} does not overlap another control at ${width}: ${JSON.stringify(boxes)}`,
				);
			}
		}
		await modelTrigger.click();
		if (compact) {
			await page
				.getByRole("button", { name: /^Model:/ })
				.filter({ visible: true })
				.click();
		}
		await page.getByRole("dialog", { name: "Search model" }).waitFor();
		const selectedModel = await page
			.getByRole("button", { name: /^Model:/ })
			.filter({ visible: true })
			.getAttribute("title");
		await page
			.getByRole("option", {
				name:
					selectedModel === "GPT-5.5"
						? "GPT-5.5 with a longer model name"
						: "GPT-5.5",
				exact: true,
			})
			.click();
		await effort.click();
		await page.getByRole("option", { name: "High", exact: true }).click();
		await page.getByRole("button", { name: "Plan", exact: true }).click();
		assert.equal(
			await page
				.getByRole("button", { name: "Plan", exact: true })
				.getAttribute("aria-pressed"),
			"true",
		);
		await page.getByRole("button", { name: "Act", exact: true }).click();
		if (process.env.COMPOSER_SCREENSHOT_DIR) {
			await mkdir(process.env.COMPOSER_SCREENSHOT_DIR, { recursive: true });
			await page.screenshot({
				path: `${process.env.COMPOSER_SCREENSHOT_DIR}/composer-${width}.png`,
			});
		}
		results.push({
			width,
			compact: compact !== null,
			model: boxes[4],
			effort: boxes[5],
		});
	}
	assert.deepEqual(errors, []);
	console.log(JSON.stringify(results, null, 2));
	console.log(
		"Composer browser layout: PASS (Files open, real menus and rectangle checks)",
	);
} finally {
	await browser?.close();
	await server.close();
}
