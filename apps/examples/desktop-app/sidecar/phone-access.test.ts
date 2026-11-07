import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	dashboardArgs,
	PhoneAccess,
	readPort80,
	readTailscaleSetup,
	SERVE_OFF_ARGS,
	type ServeStatusJson,
	type TailscaleStatusJson,
} from "./phone-access";

const NAME = "my-laptop.example-tailnet.ts.net";
const URL = `http://${NAME}`;
const READY: TailscaleStatusJson = {
	BackendState: "Running",
	Self: { DNSName: `${NAME}.` },
	CurrentTailnet: { MagicDNSEnabled: true },
};
const SERVER_SCRIPT =
	"require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[1]),'127.0.0.1')";
const STUBBORN_SCRIPT = `process.on('SIGTERM',()=>{});${SERVER_SCRIPT}`;
const DEAD_PID = 4_194_999;

function serveConfig(target: string, port = 80): ServeStatusJson {
	return {
		TCP: { [port]: port === 80 ? { HTTP: true } : { HTTPS: true } },
		Web: { [`${NAME}:${port}`]: { Handlers: { "/": { Proxy: target } } } },
	};
}

function withoutPort80(config: ServeStatusJson): ServeStatusJson {
	const { "80": _tcp, ...tcp } = config.TCP ?? {};
	const { [`${NAME}:80`]: _web, ...web } = config.Web ?? {};
	return { TCP: tcp, Web: web };
}

function startServer(port: number, script = SERVER_SCRIPT): ChildProcess {
	return spawn(process.execPath, ["-e", script, String(port)], {
		stdio: "ignore",
	});
}

async function waitForExit(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await new Promise((resolve) => child.once("exit", resolve));
}

let dir: string;
let statePath: string;
let status: TailscaleStatusJson;
let serve: ServeStatusJson;
let calls: string[][];
let children: ChildProcess[];
let serveError: string | undefined;
let controller: PhoneAccess | undefined;

function create(
	options: Partial<ConstructorParameters<typeof PhoneAccess>[0]> = {},
) {
	controller = new PhoneAccess({
		cliPath: "/bin/cline-cli",
		workspaceRoot: "/work",
		statePath,
		readyTimeoutMs: 5_000,
		killAfterMs: 200,
		findTailscale: () => async (args) => {
			calls.push(args);
			const command = args.join(" ");
			if (command === "status --json") return JSON.stringify(status);
			if (command === "debug prefs")
				return JSON.stringify({ OperatorUser: "me" });
			if (command === "serve status --json") return JSON.stringify(serve);
			if (command === SERVE_OFF_ARGS.join(" ")) {
				serve = withoutPort80(serve);
				return "";
			}
			if (args[1] === "--bg") {
				if (serveError) throw new Error(serveError);
				const added = serveConfig(args[3] ?? "");
				serve = {
					TCP: { ...serve.TCP, ...added.TCP },
					Web: { ...serve.Web, ...added.Web },
				};
				return "";
			}
			throw new Error(`unexpected tailscale ${command}`);
		},
		spawnDashboard: (args) => {
			const child = startServer(Number(args[args.indexOf("--port") + 1]));
			children.push(child);
			return child;
		},
		...options,
	});
	return controller;
}

function readState() {
	return JSON.parse(readFileSync(statePath, "utf8"));
}

function serveCalls() {
	return calls.filter((args) => args[0] === "serve" && args[1] !== "status");
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cline-phone-access-"));
	statePath = join(dir, "hub", "phone-access.json");
	status = READY;
	serve = {};
	calls = [];
	children = [];
	serveError = undefined;
	controller = undefined;
});

afterEach(async () => {
	await controller?.dispose();
	for (const child of children) child.kill("SIGKILL");
	rmSync(dir, { recursive: true, force: true });
});

describe("readTailscaleSetup", () => {
	it("is ready with a name and a matching operator", () => {
		expect(readTailscaleSetup(READY, { OperatorUser: "me" }, "me")).toEqual({
			name: NAME,
		});
	});

	it("reports the first missing step", () => {
		const cases: Array<[TailscaleStatusJson | undefined, string]> = [
			[undefined, "turned-off"],
			[{ ...READY, BackendState: "Stopped" }, "turned-off"],
			[{ ...READY, BackendState: "NeedsLogin" }, "sign-in"],
			[{ ...READY, Self: { DNSName: "" } }, "magicdns"],
			[{ ...READY, CurrentTailnet: { MagicDNSEnabled: false } }, "magicdns"],
		];
		for (const [input, missing] of cases) {
			expect(readTailscaleSetup(input, undefined, undefined)).toEqual({
				missing,
			});
		}
		expect(readTailscaleSetup(READY, { OperatorUser: "root" }, "me")).toEqual({
			missing: "operator",
		});
		expect(readTailscaleSetup(READY, {}, "me")).toEqual({
			missing: "operator",
		});
	});
});

describe("commands", () => {
	it("runs the dashboard locally without a room secret", () => {
		expect(dashboardArgs(4321, URL, "/work")).toEqual([
			"hub",
			"dashboard",
			"--no-open",
			"--port",
			"4321",
			"--public-url",
			URL,
			"--cwd",
			"/work",
		]);
	});

	it("reads what Serve port 80 forwards to", () => {
		expect(readPort80({})).toEqual({ kind: "free" });
		expect(readPort80(serveConfig("http://127.0.0.1:1", 443))).toEqual({
			kind: "free",
		});
		expect(readPort80(serveConfig("http://127.0.0.1:1"))).toEqual({
			kind: "proxy",
			target: "http://127.0.0.1:1",
		});
		expect(readPort80({ TCP: { "80": { TCPForward: "x:1" } } })).toEqual({
			kind: "other",
		});
	});
});

describe("PhoneAccess", () => {
	it("starts the dashboard, then points Serve at it", async () => {
		const result = await create().refresh();
		expect(result).toEqual({ state: "running", url: URL, elsewhere: false });
		expect(children).toHaveLength(1);
		const target = serveCalls()[0]?.[3] ?? "";
		expect(serveCalls()).toEqual([["serve", "--bg", "--http=80", target]]);
		expect(await fetch(`${target}/`).then((r) => r.text())).toBe("ok");
		expect(readState()).toEqual({
			version: 1,
			enabled: true,
			serveTarget: target,
			ownerPid: process.pid,
			dashboardPid: children[0]?.pid,
		});
		if (process.platform !== "win32")
			expect(statSync(statePath).mode & 0o777).toBe(0o600);
		expect(serveCalls().flat()).not.toContain("reset");
	});

	it("turns Serve off and stops the dashboard when switched off", async () => {
		const access = create();
		await access.refresh();
		expect(await access.setEnabled(false)).toEqual({ state: "off" });
		expect(serveCalls().at(-1)).toEqual(SERVE_OFF_ARGS);
		await waitForExit(children[0] as ChildProcess);
		expect(readState()).toEqual({ version: 1, enabled: false });
		expect(await access.refresh()).toEqual({ state: "off" });
		expect(children).toHaveLength(1);
	});

	it("shares a live dashboard between controllers in the same process", async () => {
		const owner = create();
		await owner.refresh();
		const child = children[0];
		const observer = create();
		try {
			for (let i = 0; i < 3; i++) {
				expect(await observer.refresh()).toEqual({
					state: "running",
					url: URL,
					elsewhere: false,
				});
				await owner.refresh();
			}
			expect(children).toHaveLength(1);
			expect(child?.signalCode).toBeNull();
			await observer.dispose();
			expect(serveCalls()).toHaveLength(1);
			expect(child?.signalCode).toBeNull();
		} finally {
			await observer.dispose();
			await owner.dispose();
		}
	});

	it("stops when Tailscale is turned off", async () => {
		const access = create();
		await access.refresh();
		status = { ...READY, BackendState: "Stopped" };
		expect(await access.refresh()).toEqual({
			state: "setup-needed",
			missing: "turned-off",
		});
		expect(serveCalls().at(-1)).toEqual(SERVE_OFF_ARGS);
		await waitForExit(children[0] as ChildProcess);
	});

	it("turns Serve off on shutdown, but only if port 80 is still ours", async () => {
		await create().refresh();
		await controller?.dispose();
		expect(serveCalls().at(-1)).toEqual(SERVE_OFF_ARGS);
		await waitForExit(children[0] as ChildProcess);

		calls = [];
		await create().refresh();
		serve = serveConfig("http://127.0.0.1:9999");
		await controller?.dispose();
		expect(serveCalls()).toHaveLength(1);
		expect(serve).toEqual(serveConfig("http://127.0.0.1:9999"));
	});

	it("kills a dashboard that ignores SIGTERM", async () => {
		await create({
			spawnDashboard: (args) => {
				const child = startServer(
					Number(args[args.indexOf("--port") + 1]),
					STUBBORN_SCRIPT,
				);
				children.push(child);
				return child;
			},
		}).refresh();
		await new Promise((resolve) => setTimeout(resolve, 200));
		await controller?.dispose();
		expect(children[0]?.signalCode).toBe("SIGKILL");
	});

	it("turns Serve off and reports an error when the dashboard exits", async () => {
		const access = create();
		await access.refresh();
		children[0]?.kill("SIGKILL");
		await vi.waitFor(() => expect(access.status.state).toBe("error"));
		expect(access.status).toMatchObject({
			message: expect.stringContaining("The phone dashboard stopped."),
			url: URL,
		});
		expect(serveCalls().at(-1)).toEqual(SERVE_OFF_ARGS);
	});

	it("leaves an unrelated port 80 setting alone", async () => {
		serve = serveConfig("http://127.0.0.1:9999");
		expect(await create().refresh()).toMatchObject({ state: "blocked" });
		expect(serveCalls()).toEqual([]);
		expect(children).toHaveLength(0);
	});

	it("leaves a port 443 setting alone", async () => {
		const https = serveConfig("http://127.0.0.1:9999", 443);
		serve = https;
		expect(await create().refresh()).toMatchObject({ state: "running" });
		await controller?.dispose();
		expect(serve).toEqual(https);
	});

	it("replaces a leftover from a crashed app", async () => {
		const { child: old, target: oldTarget } = await startOtherDashboard();
		writeState({
			serveTarget: oldTarget,
			ownerPid: DEAD_PID,
			dashboardPid: old.pid,
		});
		serve = serveConfig(oldTarget);
		expect(await create().refresh()).toEqual({
			state: "running",
			url: URL,
			elsewhere: false,
		});
		await waitForExit(old);
		const target = serveCalls()[0]?.[3];
		expect(target).not.toBe(oldTarget);
		expect(readState()).toMatchObject({
			serveTarget: target,
			ownerPid: process.pid,
			dashboardPid: children[1]?.pid,
		});
	});

	it("shows another running app's address without starting", async () => {
		const { target } = await startOtherDashboard();
		writeState({ serveTarget: target, ownerPid: process.ppid });
		serve = serveConfig(target);
		expect(await create().refresh()).toEqual({
			state: "running",
			url: URL,
			elsewhere: true,
		});
		expect(serveCalls()).toEqual([]);
		expect(children).toHaveLength(1);
	});

	it("reports the operator step when Serve is denied", async () => {
		serveError = "Access denied: serve config denied";
		expect(await create().refresh()).toEqual({
			state: "setup-needed",
			missing: "operator",
		});
		await waitForExit(children[0] as ChildProcess);
	});

	it("needs the bundled CLI and Tailscale", async () => {
		expect(await create({ cliPath: undefined }).refresh()).toMatchObject({
			state: "unavailable",
		});
		expect(await create({ findTailscale: () => undefined }).refresh()).toEqual({
			state: "setup-needed",
			missing: "install",
		});
	});

	it("replaces a corrupt state file", async () => {
		writeState({});
		writeFileSync(statePath, "not json");
		expect(await create().refresh()).toMatchObject({ state: "running" });
		expect(readState()).toMatchObject({ version: 1, enabled: true });
	});
});

function writeState(fields: Record<string, unknown>): void {
	mkdirSync(join(dir, "hub"), { recursive: true });
	writeFileSync(
		statePath,
		JSON.stringify({ version: 1, enabled: true, ...fields }),
	);
}

async function startOtherDashboard() {
	const port = await new Promise<number>((resolve) => {
		const server = createServer().listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
	const child = startServer(port);
	children.push(child);
	const target = `http://127.0.0.1:${port}`;
	await vi.waitFor(() => fetch(`${target}/`));
	return { child, target };
}
