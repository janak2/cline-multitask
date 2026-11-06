import { type ChildProcess, execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { BasicLogger } from "@cline/core";
import { withHubLauncherIdentity } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import type {
	PhoneAccessSetupStep,
	PhoneAccessStatus,
} from "../webview/lib/phone-access";
import { DESKTOP_CLIENT_CONTEXT } from "./client-context";

const CHECK_INTERVAL_MS = 30_000;
const TAILSCALE_TIMEOUT_MS = 5_000;
const BLOCKED_MESSAGE =
	'Tailscale Serve on port 443 is already used for something else. Remove it with "tailscale serve --https=443 off" if you no longer need it.';

export const SERVE_OFF_ARGS = ["serve", "--https=443", "off"];

type PhoneAccessState = {
	version: 1;
	enabled: boolean;
	serveTarget?: string;
	ownerPid?: number;
	dashboardPid?: number;
};

export type TailscaleStatusJson = {
	BackendState?: string;
	Self?: { DNSName?: string };
	CertDomains?: string[] | null;
	CurrentTailnet?: { MagicDNSEnabled?: boolean } | null;
};

export type ServeStatusJson = {
	TCP?: Record<string, unknown>;
	Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
	AllowFunnel?: Record<string, boolean>;
};

export type RunTailscale = (args: string[]) => Promise<string>;

export type PhoneAccessOptions = {
	cliPath?: string;
	workspaceRoot: string;
	statePath?: string;
	/** Finds Tailscale on every check, so a later install is picked up. */
	findTailscale?: () => RunTailscale | undefined;
	/** The user that must be Tailscale's operator; undefined skips the check. */
	operatorUser?: string;
	spawnDashboard?: (args: string[]) => ChildProcess;
	readyTimeoutMs?: number;
	killAfterMs?: number;
	logger?: BasicLogger;
};

type Dashboard = {
	child: ChildProcess;
	port: number;
	output: string[];
	stopping: boolean;
};

/**
 * Serves the Cline Hub dashboard to the user's own devices through Tailscale
 * Serve while the desktop app runs. The dashboard keeps its local bind; Serve
 * forwards https://<machine>.ts.net to it.
 */
export class PhoneAccess {
	status: PhoneAccessStatus = { state: "starting" };
	private dashboard?: Dashboard;
	private queue: Promise<void> = Promise.resolve();
	private timer?: ReturnType<typeof setInterval>;
	private disposed = false;
	private readonly statePath: string;
	private readonly findTailscale: () => RunTailscale | undefined;

	constructor(private readonly options: PhoneAccessOptions) {
		this.statePath =
			options.statePath ??
			join(resolveClineDataDir(), "hub", "phone-access.json");
		this.findTailscale = options.findTailscale ?? defaultFindTailscale;
	}

	start(): void {
		void this.refresh();
		this.timer = setInterval(() => void this.refresh(), CHECK_INTERVAL_MS);
		this.timer.unref?.();
	}

	refresh(): Promise<PhoneAccessStatus> {
		return this.enqueue(() => this.check());
	}

	setEnabled(enabled: boolean): Promise<PhoneAccessStatus> {
		return this.enqueue(async () => {
			writeState(this.statePath, { ...readState(this.statePath), enabled });
			await this.check();
		});
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		clearInterval(this.timer);
		await this.enqueue(() => this.stop());
	}

	private enqueue(work: () => Promise<void>): Promise<PhoneAccessStatus> {
		this.queue = this.queue.then(async () => {
			const previous = JSON.stringify(this.status);
			await work().catch((error) => {
				this.status = { state: "error", message: errorMessage(error) };
			});
			if (JSON.stringify(this.status) !== previous)
				this.options.logger?.log("Phone access status", {
					status: this.status,
				});
		});
		return this.queue.then(() => this.status);
	}

	private async check(): Promise<void> {
		if (this.disposed) return;
		const state = readState(this.statePath);
		if (!state.enabled) {
			await this.stop();
			this.status = { state: "off" };
			return;
		}
		if (!this.options.cliPath) {
			this.status = {
				state: "unavailable",
				message: "Phone access needs the bundled Cline CLI.",
			};
			return;
		}
		const tailscale = this.findTailscale();
		if (!tailscale) return this.setupNeeded("install");
		const setup = readTailscaleSetup(
			await readJson<TailscaleStatusJson>(tailscale, ["status", "--json"]),
			this.options.operatorUser
				? await readJson<{ OperatorUser?: string }>(tailscale, [
						"debug",
						"prefs",
					])
				: undefined,
			this.options.operatorUser,
		);
		if ("missing" in setup) return this.setupNeeded(setup.missing);
		const url = `https://${setup.name}`;
		const port443 = await readServePort443(tailscale);
		const ours =
			port443.kind === "proxy" && port443.target === state.serveTarget;
		if (ours && this.dashboard && state.ownerPid === process.pid) {
			this.status = { state: "running", url, elsewhere: false };
			return;
		}
		if (
			ours &&
			state.ownerPid !== process.pid &&
			isAlive(state.ownerPid) &&
			(await answers(state.serveTarget))
		) {
			await this.stop();
			this.status = { state: "running", url, elsewhere: true };
			return;
		}
		// A leftover from a crash: the old dashboard may still hold the target.
		if (
			ours &&
			state.dashboardPid !== this.dashboard?.child.pid &&
			isAlive(state.dashboardPid) &&
			(await answers(state.serveTarget))
		) {
			process.kill(state.dashboardPid, "SIGTERM");
		}
		if (!ours && port443.kind !== "free") {
			await this.stop();
			this.status = { state: "blocked", message: BLOCKED_MESSAGE };
			return;
		}
		await this.serve(tailscale, url);
	}

	private async serve(tailscale: RunTailscale, url: string): Promise<void> {
		const dashboard = this.dashboard ?? (await this.startDashboard(url));
		if (!dashboard) return;
		const target = `http://127.0.0.1:${dashboard.port}`;
		try {
			await tailscale(["serve", "--bg", "--https=443", target]);
		} catch (error) {
			await this.stop();
			if (/access denied/i.test(errorMessage(error)))
				return this.setupNeeded("operator");
			this.status = { state: "error", message: errorMessage(error) };
			return;
		}
		writeState(this.statePath, {
			...readState(this.statePath),
			serveTarget: target,
			ownerPid: process.pid,
			dashboardPid: dashboard.child.pid,
		});
		this.status = { state: "running", url, elsewhere: false };
	}

	private async startDashboard(url: string): Promise<Dashboard | undefined> {
		const port = await pickPort();
		const args = dashboardArgs(port, url, this.options.workspaceRoot);
		const dashboard: Dashboard = {
			child: (this.options.spawnDashboard ?? this.defaultSpawn)(args),
			port,
			output: [],
			stopping: false,
		};
		const record = (chunk: unknown) => {
			dashboard.output = [
				...dashboard.output,
				...String(chunk).split(/\r?\n/).filter(Boolean),
			].slice(-5);
		};
		dashboard.child.stdout?.on("data", record);
		dashboard.child.stderr?.on("data", record);
		let exited = false;
		const onExit = () => {
			if (exited) return;
			exited = true;
			if (this.dashboard === dashboard) this.dashboard = undefined;
			if (!dashboard.stopping)
				void this.enqueue(() => this.dashboardExited(dashboard));
		};
		dashboard.child.once("exit", onExit);
		dashboard.child.once("error", (error) => {
			record(error.message);
			onExit();
		});
		this.dashboard = dashboard;
		this.status = { state: "starting" };
		const deadline = Date.now() + (this.options.readyTimeoutMs ?? 15_000);
		while (this.dashboard === dashboard && !this.disposed) {
			if (await answers(`http://127.0.0.1:${port}`)) return dashboard;
			if (Date.now() > deadline) {
				await this.stop();
				this.status = {
					state: "error",
					message: withOutput(
						"The phone dashboard did not start in time.",
						dashboard,
					),
				};
				return undefined;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return undefined;
	}

	private async dashboardExited(dashboard: Dashboard): Promise<void> {
		if (this.dashboard || this.disposed) return;
		await this.stop();
		this.status = {
			state: "error",
			message: withOutput("The phone dashboard stopped.", dashboard),
		};
	}

	/** Turns our Serve setting off, then stops the dashboard. */
	private async stop(): Promise<void> {
		const state = readState(this.statePath);
		if (state.ownerPid === process.pid && state.serveTarget) {
			const tailscale = this.findTailscale();
			try {
				const port443 = tailscale
					? await readServePort443(tailscale)
					: undefined;
				if (
					tailscale &&
					port443?.kind === "proxy" &&
					port443.target === state.serveTarget
				)
					await tailscale(SERVE_OFF_ARGS);
				writeState(this.statePath, { version: 1, enabled: state.enabled });
			} catch (error) {
				// Keep the target so the next start recognises the leftover.
				this.options.logger?.error?.("Failed to turn off Tailscale Serve", {
					error,
				});
			}
		}
		const dashboard = this.dashboard;
		this.dashboard = undefined;
		if (dashboard) {
			dashboard.stopping = true;
			await stopProcess(dashboard.child, this.options.killAfterMs ?? 3_000);
		}
	}

	private async setupNeeded(missing: PhoneAccessSetupStep): Promise<void> {
		await this.stop();
		this.status = { state: "setup-needed", missing };
	}

	private defaultSpawn = (args: string[]): ChildProcess =>
		spawn(this.options.cliPath ?? "", args, {
			cwd: this.options.workspaceRoot,
			env: withHubLauncherIdentity(
				{ ...process.env, CLINE_NO_AUTO_UPDATE: "1" },
				{
					client: DESKTOP_CLIENT_CONTEXT.name,
					version: DESKTOP_CLIENT_CONTEXT.version,
					transport: "local",
				},
			),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
}

export function createPhoneAccess(options: {
	cliPath?: string;
	workspaceRoot: string;
	logger?: BasicLogger;
}): PhoneAccess {
	return new PhoneAccess({
		...options,
		operatorUser:
			process.platform === "linux" && process.getuid?.() !== 0
				? userInfo().username
				: undefined,
	});
}

/** The first missing setup step, in the order the settings panel lists them. */
export function readTailscaleSetup(
	status: TailscaleStatusJson | undefined,
	prefs: { OperatorUser?: string } | undefined,
	operatorUser: string | undefined,
): { missing: PhoneAccessSetupStep } | { name: string } {
	if (!status || status.BackendState === "Stopped")
		return { missing: "turned-off" };
	if (status.BackendState !== "Running") return { missing: "sign-in" };
	const name = status.Self?.DNSName?.replace(/\.$/, "") ?? "";
	if (!name || status.CurrentTailnet?.MagicDNSEnabled === false)
		return { missing: "magicdns" };
	if (!status.CertDomains?.length) return { missing: "https-certificates" };
	if (prefs && operatorUser && prefs.OperatorUser !== operatorUser)
		return { missing: "operator" };
	return { name };
}

/** What this machine's Serve port 443 forwards to. */
export function readPort443(
	serve: ServeStatusJson,
): { kind: "free" } | { kind: "proxy"; target: string } | { kind: "other" } {
	const key = Object.keys(serve.Web ?? {}).find((name) =>
		name.endsWith(":443"),
	);
	if (
		Object.entries(serve.AllowFunnel ?? {}).some(
			([name, on]) => on && name.endsWith(":443"),
		)
	)
		return { kind: "other" };
	if (!key && !serve.TCP?.["443"]) return { kind: "free" };
	const handlers = (key && serve.Web?.[key]?.Handlers) || {};
	const target = handlers["/"]?.Proxy;
	return Object.keys(handlers).length === 1 && target
		? { kind: "proxy", target }
		: { kind: "other" };
}

export function dashboardArgs(
	port: number,
	url: string,
	workspaceRoot: string,
): string[] {
	return [
		"hub",
		"dashboard",
		"--no-open",
		"--port",
		String(port),
		"--public-url",
		url,
		"--cwd",
		workspaceRoot,
	];
}

export function findTailscaleBinary(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): string | undefined {
	const name = platform === "win32" ? "tailscale.exe" : "tailscale";
	const fallbacks =
		platform === "darwin"
			? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
			: platform === "win32"
				? [
						join(
							env.ProgramFiles ?? "C:\\Program Files",
							"Tailscale",
							"tailscale.exe",
						),
					]
				: [];
	return [
		...(env.PATH ?? "")
			.split(delimiter)
			.filter(Boolean)
			.map((dir) => join(dir, name)),
		...fallbacks,
	].find((path) => existsSync(path));
}

function defaultFindTailscale(): RunTailscale | undefined {
	const path = findTailscaleBinary();
	if (!path) return undefined;
	return (args) =>
		new Promise((resolve, reject) => {
			execFile(
				path,
				args,
				{ timeout: TAILSCALE_TIMEOUT_MS, windowsHide: true },
				(error, stdout, stderr) => {
					if (error) reject(new Error(String(stderr).trim() || error.message));
					else resolve(String(stdout));
				},
			);
		});
}

function readJson<T>(
	tailscale: RunTailscale,
	args: string[],
): Promise<T | undefined> {
	return tailscale(args).then(
		(stdout) => JSON.parse(stdout) as T,
		() => undefined,
	);
}

async function readServePort443(tailscale: RunTailscale) {
	const stdout = await tailscale(["serve", "status", "--json"]);
	return readPort443(JSON.parse(stdout.trim() || "{}"));
}

function readState(path: string): PhoneAccessState {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed?.version === 1 && typeof parsed.enabled === "boolean")
			return {
				version: 1,
				enabled: parsed.enabled,
				serveTarget:
					typeof parsed.serveTarget === "string"
						? parsed.serveTarget
						: undefined,
				ownerPid: Number.isInteger(parsed.ownerPid)
					? parsed.ownerPid
					: undefined,
				dashboardPid: Number.isInteger(parsed.dashboardPid)
					? parsed.dashboardPid
					: undefined,
			};
	} catch {
		// A missing or corrupt file is replaced by the defaults on the next write.
	}
	return { version: 1, enabled: true };
}

function writeState(path: string, state: PhoneAccessState): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
}

function pickPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

function answers(url: string | undefined): Promise<boolean> {
	if (!url) return Promise.resolve(false);
	return fetch(`${url}/`, { signal: AbortSignal.timeout(1_000) }).then(
		(response) => {
			void response.body?.cancel();
			return true;
		},
		() => false,
	);
}

function isAlive(pid: number | undefined): pid is number {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function stopProcess(
	child: ChildProcess,
	killAfterMs: number,
): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolve) => child.once("exit", resolve));
	child.kill("SIGTERM");
	const timer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
	await exited;
	clearTimeout(timer);
}

function withOutput(message: string, dashboard: Dashboard): string {
	return [message, ...dashboard.output].join("\n");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
