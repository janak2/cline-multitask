# Plan: open Cline on your phone by scanning a QR code

Status: proposed. Nothing in this document is implemented yet.

## 1. Goal

The user opens the Cline desktop app. If Tailscale is set up on the computer, the app quietly starts the Cline Hub dashboard for the phone. The user opens **Settings → General → Cline Hub**, scans the QR code with the phone camera, and the phone browser opens the dashboard. From there the phone can see and drive the same Cline sessions.

There is no command to run. The phone needs only its normal browser and the Tailscale app.

Tailscale is a private network app. It links a user's own devices with encrypted connections wherever they are, so the phone keeps working on mobile data or another Wi-Fi. Each device gets a private address in the `100.x.y.z` range, and optionally a name such as `my-laptop.example-tailnet.ts.net` (Tailscale calls this MagicDNS).

## 2. Non-goals

- No public internet access. No Cloudflare Tunnel, ngrok or Tailscale Funnel (Funnel is Tailscale's public sharing feature). The dashboard can approve shell commands, so it must only be reachable from the user's own devices.
- No access over the local Wi-Fi without Tailscale. The dashboard listens only on the Tailscale address.
- No bundled Tailscale. The user installs it and signs in once.
- No change to how the desktop sidecar checks who may talk to it.
- No change to the dashboard server or the `cline hub dashboard` command. Their existing options already support this flow (section 4).

## 3. How it works for the user

### 3.1 One-time setup

1. Install Tailscale on the computer and the phone.
2. Sign in to the same Tailscale account on both. On Linux, run `sudo tailscale up` once.

### 3.2 Every day

1. Open the Cline desktop app. If Tailscale is connected, phone access starts on its own.
2. Open **Settings → General**. The **Cline Hub** section has a **Phone access** block with a QR code.
3. Scan it with the phone camera and tap the link. The dashboard opens.
4. Bookmark it or add it to the home screen. The link stays the same across app restarts, so the bookmark keeps working.
5. Phone access works while the desktop app is running and Tailscale is connected on both devices. Quitting the app stops it.

If Tailscale is not installed, not signed in or turned off, the app does nothing. The **Phone access** block shows one short hint, such as "Sign in to Tailscale to use Cline from your phone."

## 4. What exists today

Paths are relative to the repository root.

### 4.1 The dashboard command

`cline hub dashboard` (`apps/cli/src/commands/dashboard-command.ts`) accepts `--host`, `--port`, `--public-url`, `--room-secret`, `--no-open` and `--cwd`. `apps/cli/src/commands/dashboard.ts` turns them into the environment variables `HOST`, `CLINE_HUB_DASHBOARD_PORT`, `PUBLIC_URL` and `ROOM_SECRET`, then starts the server from `@cline/cline-hub`. The dashboard joins the shared Hub daemon through `ensureDetachedHubServer`, as the desktop app does (`apps/cline-hub/src/server/hub.ts`).

The compiled CLI binary embeds the dashboard web page (`apps/cli/script/compile-binary.ts` and `dashboard-runtime.ts`), so the `cline-cli` binary that ships with the desktop app can run the dashboard as is.

### 4.2 Options

`apps/cline-hub/src/options.ts`:

- `HOST` defaults to `127.0.0.1`; the port defaults to `8787`.
- Any host other than `127.0.0.1`, `localhost` or `::1` is "non-local". A non-local host without `ROOM_SECRET` refuses to start.
- `PUBLIC_URL` gets the port added only when its host is an IP address or `localhost`. For a name such as `my-laptop.example-tailnet.ts.net`, the port must be written into `PUBLIC_URL` by the caller.

### 4.3 Request checks

`apps/cline-hub/src/server/browser-auth.ts` decides who may use the dashboard.

- Anyone who can reach the port can load the page itself. Live data needs a check: the `/browser` WebSocket, any non-GET request and any non-public GET.
- A checked request must carry a `Host` header and an `Origin` header that match the public URL or the bind address (with the port). This blocks DNS rebinding, where a hostile website points its own domain name at your computer.
- For a non-local bind, the `127.0.0.1`, `localhost` and `[::1]` aliases are not allowed.
- When `ROOM_SECRET` is set, the request must also carry `?roomSecret=<secret>`.

So with `HOST=<Tailscale IPv4>` and `PUBLIC_URL=http://<MagicDNS name>:<port>`, both the IP form and the name form of the address are accepted, and nothing else is.

The dashboard web page copies `roomSecret` from the page address into the WebSocket address (`apps/cline-hub/src/webview/src/vscode.ts`), and its in-app navigation keeps the query string (`routePath` in `apps/cline-hub/src/webview/src/App.tsx`). A link with `?roomSecret=` therefore keeps working as the user moves between pages.

### 4.4 The desktop app

- The Tauri shell starts one Bun sidecar backend and passes it the bundled CLI path in `CLINE_DESKTOP_CLI_PATH` (`apps/examples/desktop-app/sidecar/cli-runtime.ts`). The sidecar already runs `cline-cli hub ensure` this way.
- The app is single-instance (`tauri_plugin_single_instance` in `src-tauri/src/main.rs`). All windows share one sidecar.
- When the app quits, the shell sends the sidecar `SIGTERM`. The sidecar's `shutdown` in `sidecar/index.ts` runs `disposeSidecarContext` (`sidecar/context.ts`) before it exits.
- The sidecar runs a login-shell `PATH` lookup at startup (`sidecar/index.ts`), so a `tailscale` installed by a package manager is found.
- Settings → General already ends with a **Cline Hub** section: `webview/components/views/settings/hub-panel.tsx`, rendered by `settings-view.tsx`. It polls `get_hub_status` every 2 seconds. Hub commands in `sidecar/commands.ts` refuse callers without `canApproveTools` (the trusted webview connection).
- Private files are already written with mode `0600` (for example `sidecar/feature-flags.ts`), and `resolveClineDataDir()` from `@cline/shared/storage` gives the data directory (`~/.cline/data` by default).
- No QR library is installed in the desktop app or the hub.

## 5. Design

### 5.1 Shape

The sidecar owns phone access. When Tailscale is ready, it starts the bundled CLI as a child process:

```shell
cline-cli hub dashboard --no-open \
  --host <tailscale-ipv4> --port <port> \
  --public-url http://<link-host>:<port> \
  --room-secret <secret> --cwd <workspace root>
```

- `--host` is the Tailscale IPv4 address. The dashboard listens only there. Devices on the local Wi-Fi cannot reach it, because the address does not exist on that network.
- `--room-secret` is a long random value saved on disk (section 5.3). It is required for a non-local host, and it is what stops other tailnet devices from using the dashboard.
- `<link-host>` is the MagicDNS name when MagicDNS is on, otherwise the IP (section 5.2).
- `--cwd` is the workspace root the sidecar already passes to `hub ensure`.
- The child gets the same environment as `hub ensure`: `CLINE_NO_AUTO_UPDATE=1` and the desktop launcher identity from `withHubLauncherIdentity`.

The link in the QR code is `http://<link-host>:<port>/?roomSecret=<secret>`, built the same way as `buildInviteUrl` in `options.ts`.

Traffic is plain HTTP, but Tailscale encrypts everything between the phone and the computer. The browser still labels the page "not secure", which is expected.

Running the existing command as a child is simpler than starting the dashboard inside the sidecar. The dashboard reads its options from environment variables once at import time (`apps/cline-hub/src/server/deps.ts`), and the sidecar does not depend on `@cline/cline-hub`.

### 5.2 Detecting Tailscale

The sidecar runs `tailscale status --json` with a 5-second timeout. It finds `tailscale` on `PATH`, then at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` on macOS and `%ProgramFiles%\Tailscale\tailscale.exe` on Windows. Reading status needs no `sudo`.

It reads:

| Field | Meaning |
| --- | --- |
| `BackendState` | Must be `Running`. `NeedsLogin` means not signed in; `Stopped` means turned off. |
| `Self.TailscaleIPs` | The first IPv4 address (in `100.64.0.0/10`) becomes `--host`. |
| `Self.DNSName` | The MagicDNS name, for example `my-laptop.example-tailnet.ts.net.`. The trailing dot is removed. |
| `CurrentTailnet.MagicDNSEnabled` | When true and the name is not empty, the link uses the name; otherwise the IP. |

The name is easier to read and stays the same if the device's IP ever changes. The IP works even when MagicDNS is off. Both are accepted by the request checks (section 4.3), so a bookmark of either form keeps working.

Readiness is checked at sidecar startup and then every 30 seconds. This picks up a user who signs in to Tailscale after opening the app, and stops the dashboard when Tailscale is turned off. If the IPv4 address or the link host changes, the dashboard restarts with the new values.

### 5.3 The saved secret

File: `<Cline data dir>/hub/phone-access.json`, created with directory mode `0700` and file mode `0600`, written through a temporary file and a rename.

```json
{ "version": 1, "enabled": true, "secret": "<32 random bytes, base64url>", "port": 8787, "ownerPid": 1234, "dashboardPid": 5678 }
```

- `secret` is created the first time and reused afterwards, so the QR link stays the same across restarts.
- `enabled` is the user's on/off choice. It defaults to `true`.
- `port` is `8787` unless the user changes it later; it is saved so the link does not drift.
- `ownerPid` and `dashboardPid` record which sidecar started which child. They are used only to clean up after a crash (section 5.5).
- If the file cannot be read or parsed, a new one is written with a new secret. Old links stop working.

### 5.4 Start and stop

- **Start** when `enabled` is true, Tailscale is ready and the bundled CLI path is known. The sidecar spawns the child, then waits up to 15 seconds for an HTTP `GET /` on the Tailscale address to answer. Its status becomes `running`.
- **Stop** when the user turns it off, when Tailscale stops being ready, and in `disposeSidecarContext` when the app quits. Stopping sends `SIGTERM` to the child and `SIGKILL` after 3 seconds.
- If the child exits on its own, the sidecar records its last output lines as the error and tries again on the next 30-second check.
- Without `CLINE_DESKTOP_CLI_PATH` (some development setups), the status is `unavailable` with the message "Phone access needs the bundled Cline CLI."

**Why it stops when the app quits.** The dashboard is a separate process from the Hub daemon. Keeping it alive after the app quits would need a second supervisor to restart it, update it and clean it up. Tying it to the app gives one simple rule: "phone access works while Cline is open". The Hub daemon itself is unchanged and keeps its own lifetime.

### 5.5 Busy port, crashes and more than one app

All windows share one sidecar, so there is only ever one dashboard per app.

Before spawning, the sidecar tries to bind the port on the Tailscale address and releases it at once. If the port is busy:

1. **Another Cline app owns it.** This happens when the stable and Beta apps run side by side. The saved `ownerPid` is alive and is not this sidecar. Both apps share the data directory, so the running dashboard uses the same secret and port. The status is `running` with the note "Running from another Cline app", and the same QR is shown. When that app quits, the next 30-second check here finds the port free and starts a dashboard.
2. **A leftover child from a crashed app.** The saved `ownerPid` is dead but `dashboardPid` is alive. The sidecar stops that process, then tries once more.
3. **Another program.** The status is `error` with "Port 8787 on the Tailscale address is in use by another program." The sidecar does not pick another port by itself, because that would silently change the bookmarked link.

### 5.6 Commands the webview uses

Added to `sidecar/commands.ts`. Each refuses callers without `canApproveTools`, like `get_hub_status`, because the result contains the secret.

| Command | Does |
| --- | --- |
| `get_phone_access` | Returns the current status. With `{ refresh: true }`, checks Tailscale again first. |
| `set_phone_access_enabled` | Saves `enabled`, then starts or stops the dashboard. |
| `regenerate_phone_access_link` | Writes a new secret and restarts the dashboard. Old links stop working. |

The status shape, in `webview/lib/phone-access.ts`:

```ts
type PhoneAccessStatus =
	| { state: "off" }
	| { state: "no-tailscale"; reason: "not-installed" | "logged-out" | "stopped" | "no-address" }
	| { state: "starting" }
	| { state: "running"; url: string; tailscaleIp: string; dnsName?: string; elsewhere: boolean }
	| { state: "unavailable" | "error"; message: string }
```

### 5.7 The Phone access block in settings

A new `phone-access-panel.tsx`, rendered inside `HubPanel` under the existing Hub header, so it reads as part of the **Cline Hub** section. It polls `get_phone_access` every 2 seconds, as `HubPanel` does for the Hub.

- A heading **Phone access** and a `Switch` for on/off, in the same row layout as the other General settings.
- One status line:
  - Running: "Tailscale connected · my-laptop.example-tailnet.ts.net" (or the IP). Adds "Running from another Cline app" when that applies.
  - No Tailscale: one hint per reason, for example "Install Tailscale and sign in to use Cline from your phone" with a link to the Tailscale download page, or "Tailscale is off. Turn it on, or run `sudo tailscale up` on Linux." A **Check again** button calls `get_phone_access` with `refresh: true`.
  - Error or unavailable: the message, in the destructive text style.
- When running:
  - The QR code as SVG, about 200 pixels, drawn dark on a white square so phones can read it in dark mode too.
  - The link as text, with the secret part hidden behind dots, and a **Copy link** button that copies the full link.
  - A **New link** button. It opens an `AlertDialog`: "Phones using the current link will stop working. You'll need to scan the new QR code." Confirming calls `regenerate_phone_access_link`.
  - One line: "Anyone with this link and access to your Tailscale network can control Cline on this computer."

### 5.8 QR library

Neither the desktop app nor the hub has a QR library. The plan adds [`uqr`](https://www.npmjs.com/package/uqr) to `apps/examples/desktop-app/package.json`. It is MIT licensed, has no dependencies and has a `renderSVG` function, so the panel needs only a few lines.

The alternative is to copy OpenCode's dependency-free encoder ([`packages/util/src/qr.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/util/src/qr.ts), about 320 lines, MIT) into `webview/lib/qr.ts`, keeping its MIT notice. That avoids a dependency but adds code to maintain.

### 5.9 What this replaces

An earlier version of this plan used Tailscale Serve (HTTPS through Tailscale's own proxy), one-time pairing codes, per-device cookies, a **Phone** page in the dashboard, and new `--tailscale` and `--lan` CLI flags. This version drops all of that in favour of the existing room secret.

- It needs no server changes, no admin-console settings (HTTPS certificates), and no `sudo tailscale set --operator` on Linux.
- It loses per-device revoke. **New link** signs out every phone at once.
- It loses HTTPS. Tailscale still encrypts the traffic.

Pairing codes and cookies can be added later on top of this, if per-device revoke is needed.

## 6. Security, in plain words

**The link is a password.** Anyone who has the link and can reach the computer through Tailscale gets full control. That includes starting sessions and approving shell commands. Do not share the QR code or a screenshot of it. If a phone is lost or the link leaks, press **New link**.

**Only your Tailscale network can reach it.** The dashboard listens only on the Tailscale address. People on the same café Wi-Fi cannot connect at all. Other devices in the same Tailscale network can reach the port, but they still need the secret. On a shared Tailscale network, use Tailscale access rules to limit who can reach this computer.

**The link is stored on the phone.** The secret is part of the address, so it ends up in the phone's browser history and bookmarks. This is the price of a link that keeps working. A locked phone protects it; **New link** cancels it.

**Plain HTTP is still encrypted.** Tailscale encrypts all traffic between devices, so nobody on the networks in between can read it. The browser shows "not secure" only because it does not know about Tailscale. Some browser features, such as copying to the clipboard, may not work on the phone.

**Other websites cannot use it.** The existing `Host` and `Origin` checks reject requests that start on other websites, even from the phone's own browser.

**The secret file.** It is readable only by your user account, like the rest of the Cline data directory.

**Never public.** The app never runs `tailscale serve` or `tailscale funnel`.

## 7. Files to add and change

All paths under `apps/examples/desktop-app/` unless they start with `apps/cline-hub/`.

### 7.1 New files

| File | What it holds |
| --- | --- |
| `sidecar/phone-access.ts` | Tailscale lookup and status parsing (pure functions that take the JSON), the state file, building the CLI arguments and the link, the busy-port and leftover-child checks, the 30-second check loop, start and stop of the child. The process runner, clock and port probe are passed in, so tests need no real Tailscale. |
| `sidecar/phone-access.test.ts` | Tests in section 8.1. |
| `webview/lib/phone-access.ts` | `PhoneAccessStatus` type, shared by sidecar and webview (like `webview/lib/hub-status.ts`). |
| `webview/components/views/settings/phone-access-panel.tsx` | The block in section 5.7. |
| `webview/components/views/settings/phone-access-panel.test.tsx` | Tests in section 8.2. |

### 7.2 Changed files

| File | Change |
| --- | --- |
| `sidecar/types.ts` | Add the phone access controller to `SidecarContext`. |
| `sidecar/index.ts` | Create and start the controller after Hub startup begins. |
| `sidecar/context.ts` | Stop the controller in `disposeSidecarContext`. |
| `sidecar/commands.ts` | The three commands in section 5.6, with the `canApproveTools` check. |
| `sidecar/commands-settings.test.ts` | The three commands refuse an untrusted connection. |
| `webview/components/views/settings/hub-panel.tsx` | Render `<PhoneAccessPanel />` in the Cline Hub section. |
| `package.json` | Add `uqr`. |
| `README.md` | A short "Use Cline from your phone" section: install Tailscale on both devices, sign in, scan the QR in Settings, and the security points from section 6. |
| `apps/cline-hub/src/server/browser-auth.test.ts` | Pin the contract this design relies on (section 8.3). Test only; no server change. |

## 8. Tests

### 8.1 `sidecar/phone-access.test.ts`

Tailscale status:

- `Running`, an IPv4 address, a name and `MagicDNSEnabled: true` give a link `http://my-laptop.example-tailnet.ts.net:8787/?roomSecret=…` and `--host 100.x.y.z`.
- The same with `MagicDNSEnabled: false` gives a link with the IP.
- `NeedsLogin`, `Stopped`, no IPv4 address, a missing binary and a timeout each give the matching `no-tailscale` reason.

State file:

- The first load creates a 43-character base64url secret, `enabled: true` and port `8787`, with mode `0600` (skipped on Windows).
- A second load returns the same secret.
- Regenerating changes the secret. A corrupt file is replaced.

Lifecycle, with a fake process runner:

- Enabled and Tailscale ready: spawns once with the expected arguments; the status becomes `running` after the readiness probe answers.
- Turning it off, or Tailscale going to `Stopped`, stops the child. Turning it on again starts it.
- A changed IPv4 address restarts the child with the new `--host`.
- Shutdown stops the child, with `SIGKILL` after the grace period if it ignores `SIGTERM`.
- Busy port with a live `ownerPid` from another process: no spawn, `running` with `elsewhere: true`.
- Busy port with a dead `ownerPid` and a live `dashboardPid`: stops that process, then spawns.
- Busy port otherwise: `error` with the port message, and no spawn.
- No CLI path: `unavailable`.

### 8.2 `phone-access-panel.test.tsx`

- `running`: shows an SVG QR code, the masked link and **Copy link**; copying writes the full link.
- `no-tailscale`: shows the hint and **Check again**, and no QR. **Check again** calls `get_phone_access` with `refresh: true`.
- The switch calls `set_phone_access_enabled`.
- **New link** opens the dialog. Confirming calls `regenerate_phone_access_link`.

### 8.3 `browser-auth.test.ts`

With `bindHost: "100.101.102.103"`, `publicUrl: "http://my-laptop.example-tailnet.ts.net:8787"` and a room secret:

- A WebSocket upgrade with the secret passes for both the IP and the name, each with a matching `Origin`.
- Without the secret, or with a wrong one, it fails.
- `Host: 127.0.0.1:8787` fails.

## 9. How to verify

Automated, from `apps/examples/desktop-app`: `bun run typecheck`, `bun run test:sidecar` and `bun run test:settings-ui`. From `apps/cline-hub`: `bun run test`. Then `bun run check` from the repository root.

By hand, on a computer with Tailscale running and a phone signed in to the same account:

1. Open the app. Settings → General → Cline Hub shows "Tailscale connected" and a QR code. `ss -ltn` (Linux) or `lsof -iTCP:8787 -sTCP:LISTEN` (macOS) shows port 8787 bound only on the 100.x address.
2. Scan the QR code. On the phone, open a session, send a message and approve a tool call.
3. Turn off Wi-Fi on the phone and repeat over mobile data.
4. Navigate between pages on the phone, reload, and confirm it stays connected.
5. Quit the app. The port closes and the phone shows it is disconnected. Reopen the app; the bookmarked link works again.
6. Press **New link**. The old bookmark is refused; the new QR code works.
7. Run `sudo tailscale down`. Within 30 seconds the panel shows "Tailscale is off" and the port closes. `sudo tailscale up` brings it back.
8. Turn the switch off, restart the app, and confirm it stays off.
9. Start `cline hub dashboard --host <100.x address> --room-secret test --no-open` first, then open the app. The panel shows the port message.
10. Run the Beta app next to the stable app. The second one shows "Running from another Cline app" with the same QR code.
11. Kill the sidecar process with `kill -9`, reopen the app, and confirm the leftover dashboard is replaced.

## 10. Open questions

1. Is adding the `uqr` dependency acceptable, or should the OpenCode encoder be copied instead (section 5.8)?
2. Should phone access default to on for existing users after an update, or only start once they turn it on? This plan defaults to on, as requested.
3. If port 8787 is taken by another program, is the error message enough, or should the panel let the user pick a port?
