"use client";

import { Switch } from "@cline/ui";
import { Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { renderSVG } from "uqr";
import { Button } from "@/components/ui/button";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import type {
	PhoneAccessSetupStep,
	PhoneAccessStatus,
} from "@/lib/phone-access";

const TAILSCALE_DNS_PAGE = "https://login.tailscale.com/admin/dns";

const SETUP_STEPS: Record<
	PhoneAccessSetupStep,
	{ message: ReactNode; link?: { label: string; url: string } }
> = {
	install: {
		message:
			"Install Tailscale on this computer and your phone to use Cline from your phone.",
		link: {
			label: "Download Tailscale",
			url: "https://tailscale.com/download",
		},
	},
	"sign-in": {
		message: (
			<>
				Sign in to Tailscale. On Linux, run <code>sudo tailscale up</code>.
			</>
		),
	},
	"turned-off": {
		message:
			"Tailscale is turned off. Turn it on to use Cline from your phone.",
	},
	magicdns: {
		message: "Turn on MagicDNS in the Tailscale admin console.",
		link: { label: "Open DNS settings", url: TAILSCALE_DNS_PAGE },
	},
	operator: {
		message: (
			<>
				Allow Cline to set up Tailscale Serve: run{" "}
				<code>sudo tailscale set --operator=$USER</code> once.
			</>
		),
	},
};

export function PhoneAccessPanel() {
	const [status, setStatus] = useState<PhoneAccessStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		async function refresh() {
			try {
				const next =
					await desktopClient.invoke<PhoneAccessStatus>("get_phone_access");
				if (!cancelled) setStatus(next);
			} catch (cause) {
				if (!cancelled)
					setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (!cancelled) timer = setTimeout(refresh, 2000);
			}
		}
		void refresh();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, []);

	async function run(command: string, args: Record<string, unknown>) {
		setBusy(true);
		try {
			setStatus(await desktopClient.invoke<PhoneAccessStatus>(command, args));
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}

	const step =
		status?.state === "setup-needed" ? SETUP_STEPS[status.missing] : undefined;
	const link = step?.link;
	const phoneUrl =
		status?.state !== "off" && status?.state !== "setup-needed"
			? status?.url
			: undefined;

	return (
		<div className="mt-4 rounded-lg border p-4">
			<div className="flex items-center justify-between gap-5">
				<div className="flex flex-col gap-1">
					<h3 className="text-sm font-semibold">Phone access</h3>
					<p className="text-sm text-muted-foreground">
						Open Cline on your phone through Tailscale while this app is
						running.
					</p>
				</div>
				<Switch
					aria-label="Phone access"
					checked={status !== null && status.state !== "off"}
					disabled={!status || busy}
					onCheckedChange={(enabled) =>
						void run("set_phone_access_enabled", { enabled })
					}
				/>
			</div>
			{phoneUrl ? (
				<div className="mt-4 flex gap-4 max-[720px]:flex-col">
					{/* biome-ignore lint/performance/noImgElement: In-memory data URLs cannot use Next's optimizer. */}
					<img
						alt="QR code for the phone address"
						className="size-[200px] shrink-0 rounded-md bg-white"
						src={`data:image/svg+xml;utf8,${encodeURIComponent(
								renderSVG(phoneUrl, {
								border: 2,
								whiteColor: "#ffffff",
								blackColor: "#000000",
							}),
						)}`}
					/>
					<div className="flex min-w-0 flex-col gap-2 text-sm">
						<p className="break-all font-mono text-xs">{phoneUrl}</p>
						<div>
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									void navigator.clipboard
										.writeText(phoneUrl)
										.then(() => setCopied(true))
								}
							>
								<Copy className="size-3" />
								{copied ? "Copied" : "Copy link"}
							</Button>
						</div>
						<p className="text-muted-foreground">
							{status?.state === "running"
								? `Tailscale connected${status.elsewhere ? ". Running from another Cline app." : ""}`
								: "Dashboard unavailable. This address will work when it is running again."}
						</p>
						<p className="text-muted-foreground">
							Any device in your Tailscale network can open this and control
							Cline on this computer.
						</p>
						<p className="text-muted-foreground">
							The phone browser may call the page "Not secure" because it uses
							http. Tailscale still encrypts the connection.
						</p>
					</div>
				</div>
			) : null}
			{step ? (
				<div className="mt-3 flex flex-col items-start gap-2 text-sm">
					<p className="text-muted-foreground">{step.message}</p>
					<div className="flex gap-2">
						{link ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => void openExternalUrl(link.url)}
							>
								{link.label}
							</Button>
						) : null}
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => void run("get_phone_access", { refresh: true })}
						>
							Check again
						</Button>
					</div>
				</div>
			) : null}
			{status?.state === "starting" ? (
				<p className="mt-3 text-sm text-muted-foreground">Starting…</p>
			) : null}
			{status?.state === "blocked" ||
			status?.state === "unavailable" ||
			status?.state === "error" ? (
				<p className="mt-3 whitespace-pre-line text-sm text-destructive">
					{status.message}
				</p>
			) : null}
			{error ? (
				<p className="mt-3 text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
