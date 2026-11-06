# Plan: open Cline on your phone by scanning a QR code

Status: implemented. This document describes what the desktop app does.

## 1. Goal

The user opens the Cline desktop app. If Tailscale is set up on the computer, the app quietly starts the Cline Hub dashboard for the phone. The user opens **Settings → General → Cline Hub**, scans the QR code with the phone camera, and the phone browser opens the dashboard. From there the phone can see and drive the same Cline sessions.

There is no command to run. The phone needs only its normal browser and the Tailscale app.

Tailscale is a private network app. It links a user's own devices with encrypted connections wherever they are, so the phone keeps working on mobile data or another Wi-Fi. The set of devices signed in to one Tailscale account is called a "tailnet". Each device gets a name such as `my-laptop.example-tailnet.ts.net` (Tailscale calls this MagicDNS).

Tailscale Serve is a Tailscale feature that accepts HTTPS connections from devices in the tailnet and forwards them to a port on the computer. It uses a real certificate for the device name. The phone therefore opens `https://my-laptop.example-tailnet.ts.net` with a padlock, while the dashboard itself keeps listening only on `127.0.0.1`.

## 2. Non-goals

- No extra sign-in. There is no room secret, no secret in the link and no pairing code. Being in the user's tailnet is the only gate (section 6).
- No public internet access. No Cloudflare Tunnel, ngrok or Tailscale Funnel (Funnel is Tailscale's public sharing feature).
- No access over the local Wi-Fi without Tailscale.
- No bundled Tailscale. The user installs it and does the one-time setup.
- No change to the dashboard server, its options or the `cline hub dashboard` command (section 4).
- No change to how the desktop sidecar checks who may talk to it.

## 3. How it works for the user

### 3.1 One-time setup

1. Install Tailscale on the computer and the phone, and sign in to the same account on both. On Linux, run `sudo tailscale up`.
2. In the Tailscale admin console, turn on HTTPS certificates. See [Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https). MagicDNS must be on too; it is on by default for new tailnets.
3. On Linux only, run `sudo tailscale set --operator=$USER` once. This lets the app change Serve settings without `sudo`. On macOS and Windows the Tailscale app already allows it.

The settings panel checks each step and says which one is missing (section 5.7).

### 3.2 Every day

1. Open the Cline desktop app. If the setup is complete, phone access starts on its own.
2. Open **Settings → General**. The **Cline Hub** section has a **Phone access** block with a QR code for `https://<machine>.<tailnet>.ts.net`.
3. Scan it with the phone camera and tap the link. The dashboard opens.
4. Bookmark it or add it to the home screen. The address never changes.
5. Phone access works while the desktop app is running and Tailscale is connected on both devices. Quitting the app stops it.

If Tailscale is not installed or not signed in, the app does nothing. The **Phone access** block shows one short hint.

## 4. What existed before this change

Paths are relative to the repository root.

### 4.1 The dashboard command

`cline hub dashboard` (`apps/cli/src/commands/dashboard-command.ts`) accepts `--host`, `--port`, `--public-url`, `--room-secret`, `--no-open` and `--cwd`. `apps/cli/src/commands/dashboard.ts` turns them into the environment variables `HOST`, `CLINE_HUB_DASHBOARD_PORT`, `PUBLIC_URL` and `ROOM_SECRET`, then starts the server from `@cline/cline-hub`. The dashboard joins the shared Hub daemon through `ensureDetachedHubServer` (`apps/cline-hub/src/server/hub.ts`), as the desktop app does.

The compiled CLI binary embeds the dashboard web page (`apps/cli/script/compile-binary.ts` and `dashboard-runtime.ts`). So the `cline-cli` binary that ships with the desktop app can run the dashboard as it is.

### 4.2 Options

`apps/cline-hub/src/options.ts`:

- `HOST` defaults to `127.0.0.1`. That is a local bind, which needs no `ROOM_SECRET`.
- The port accepts 1 to 65535 (not 0).
- `PUBLIC_URL` must be `http:` or `https:`. A port is added only when the host is an IP address or `localhost`, so `https://my-laptop.example-tailnet.ts.net` stays as written.

### 4.3 Request checks

`apps/cline-hub/src/server/browser-auth.ts` decides who may use the dashboard.

- Anyone who can reach the port can load the page itself. Live data needs a check: the `/browser` WebSocket, any non-GET request and any non-public GET.
- A checked request must carry a `Host` header and an `Origin` header on an allowlist. This blocks DNS rebinding, where a hostile website points its own domain name at your computer, and it stops other websites from driving the dashboard through your browser.
- The allowlists hold the public URL, plus the bind address and the `127.0.0.1`, `localhost` and `[::1]` aliases with the dashboard port, for a local bind.
- The check does not look at the caller's network address or at `X-Forwarded-*` headers.

### 4.4 What Serve sends, and why it passes

Tailscale Serve forwards each request with Go's standard reverse proxy ([Serve docs](https://tailscale.com/kb/1312/serve)):

- `Host` stays the name the phone used: `my-laptop.example-tailnet.ts.net`, with no port, because 443 is the default HTTPS port.
- The browser's `Origin` passes through unchanged: `https://my-laptop.example-tailnet.ts.net`.
- Serve adds `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto: https`, and `Tailscale-User-*` identity headers for signed-in users. The dashboard ignores all of these.
- WebSocket upgrades are proxied. The dashboard web page builds a `wss:` address when the page is HTTPS (`apps/cline-hub/src/webview/src/vscode.ts`), so `/browser` works through Serve with no change.

With `HOST=127.0.0.1` and `PUBLIC_URL=https://my-laptop.example-tailnet.ts.net`, the allowlists become:

- hosts: `my-laptop.example-tailnet.ts.net`, `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`
- origins: `https://my-laptop.example-tailnet.ts.net`, `https://127.0.0.1:<port>`, `https://localhost:<port>`, `https://[::1]:<port>`

A request shaped like a Serve-forwarded WebSocket upgrade was checked against the current `isAuthorizedBrowserRequest`. It passes with the ts.net `Host` and `Origin`, and fails with a foreign `Origin`.

One side effect: the loopback origins take the public URL's scheme (`https:`). A browser on the computer that opens `http://127.0.0.1:<port>` directly is refused. The computer's own browser should use the ts.net address too. Nothing in the desktop app opens the local address.

### 4.5 The desktop app

- The Tauri shell starts one Bun sidecar backend and passes it the bundled CLI path in `CLINE_DESKTOP_CLI_PATH` (`apps/examples/desktop-app/sidecar/cli-runtime.ts`). The sidecar already runs `cline-cli hub ensure` this way.
- The app is single-instance (`tauri_plugin_single_instance` in `src-tauri/src/main.rs`). All windows share one sidecar.
- When the app quits, the shell sends the sidecar `SIGTERM`. The sidecar's `shutdown` in `sidecar/index.ts` runs `disposeSidecarContext` (`sidecar/context.ts`) before it exits.
- The sidecar runs a login-shell `PATH` lookup at startup (`sidecar/index.ts`), so a `tailscale` installed by a package manager is found.
- Settings → General already ends with a **Cline Hub** section: `webview/components/views/settings/hub-panel.tsx`, rendered by `settings-view.tsx`. It polls `get_hub_status` every 2 seconds. Hub commands in `sidecar/commands.ts` refuse callers without `canApproveTools` (the trusted webview connection).
- Private files are already written with mode `0600` (for example `sidecar/feature-flags.ts`). `resolveClineDataDir()` from `@cline/shared/storage` gives the data directory (`~/.cline/data` by default).
- No QR library is installed in the desktop app or the hub.

## 5. Design

### 5.1 Shape

The sidecar owns phone access. When the setup is complete, it does three things:

1. Picks a free local port by binding `127.0.0.1:0`, reading the port and closing it.
2. Starts the bundled CLI as a child process:

   ```shell
   cline-cli hub dashboard --no-open --port <free port> \
     --public-url https://<machine>.<tailnet>.ts.net --cwd <workspace root>
   ```

   `--host` is left at its default, `127.0.0.1`. The child gets the same environment as `hub ensure`: `CLINE_NO_AUTO_UPDATE=1` and the desktop launcher identity from `withHubLauncherIdentity`.
3. Once the dashboard answers `GET /` on the local port, points Serve at it:

   ```shell
   tailscale serve --bg --https=443 http://127.0.0.1:<free port>
   ```

The QR code holds `https://<machine>.<tailnet>.ts.net`. The local port never appears in it, so the port can change on every start.

`--bg` saves the setting in Tailscale itself, so it survives the command exiting and even a reboot. That is why the sidecar must remove it on quit and must recognise a leftover one after a crash (section 5.5). The commands follow the syntax from Tailscale 1.52 onward ([`tailscale serve` reference](https://tailscale.com/kb/1242/tailscale-serve)).

Running the existing command as a child is simpler than starting the dashboard inside the sidecar. The dashboard reads its options from environment variables once at import time (`apps/cline-hub/src/server/deps.ts`), and the sidecar does not depend on `@cline/cline-hub`.

### 5.2 Detecting Tailscale and the setup steps

The sidecar finds `tailscale` on `PATH`, then at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` on macOS and `%ProgramFiles%\Tailscale\tailscale.exe` on Windows. Every call has a 5-second timeout. None of the reads need `sudo`.

From `tailscale status --json`:

| Field | Meaning |
| --- | --- |
| `BackendState` | Must be `Running`. `Stopped` means turned off; any other state, such as `NeedsLogin`, means not signed in. If the command fails (the Tailscale service is not running), Tailscale counts as turned off. |
| `Self.DNSName` | The machine name, for example `my-laptop.example-tailnet.ts.net.`. The trailing dot is removed. Empty means MagicDNS is off. |
| `CurrentTailnet.MagicDNSEnabled` | `false` also means MagicDNS is off. |
| `CertDomains` | Names Tailscale can issue certificates for. Empty means HTTPS certificates are off in the admin console. |

On Linux, `tailscale debug prefs` gives `OperatorUser`. If it is not the current user (and the app is not running as root), the operator step is missing. As a fallback, a `tailscale serve` failure whose output says access was denied is reported the same way.

From `tailscale serve status --json`, the sidecar reads what port 443 on this machine forwards to: the `Web` entry whose key ends in `:443`, its `Handlers["/"].Proxy`, plus any `AllowFunnel` entry for port 443. Port 443 counts as free only when there is no such `Web` entry and no `TCP["443"]`. A handler on any other path, or a raw TCP forward, counts as someone else's setting.

Readiness is checked at sidecar startup and then every 30 seconds. This picks up a user who finishes the setup after opening the app, and stops phone access when Tailscale is turned off.

### 5.3 The state file

File: `<Cline data dir>/hub/phone-access.json`, created with directory mode `0700` and file mode `0600`, written through a temporary file and a rename. It holds no secrets.

```json
{ "version": 1, "enabled": true, "serveTarget": "http://127.0.0.1:43117", "ownerPid": 1234, "dashboardPid": 5678 }
```

- `enabled` is the user's on/off choice. It defaults to `true`.
- `serveTarget` is the Serve target this app last set. It tells "our" Serve setting apart from one the user made.
- `ownerPid` and `dashboardPid` record which sidecar started which dashboard. They are used only to clean up after a crash and to notice another Cline app.
- If the file cannot be read or parsed, it is replaced with the defaults.

### 5.4 Start and stop

**Start** when `enabled` is true, every setup step passes and the bundled CLI path is known:

1. Check port 443 in the Serve status (section 5.5). Stop here if it belongs to someone else.
2. Pick a free port and spawn the dashboard. Wait up to 15 seconds for `GET /` on `127.0.0.1:<port>` to answer.
3. Run `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, then save `serveTarget`, `ownerPid` and `dashboardPid`.
4. The status becomes `running`.

**Stop** when the user turns it off, when Tailscale stops being ready, and in `disposeSidecarContext` when the app quits:

1. If port 443 still forwards to our `serveTarget`, run `tailscale serve --https=443 off`. This removes only the port 443 setting. The sidecar never runs `tailscale serve reset`, which would clear every Serve setting on the machine.
2. Send `SIGTERM` to the dashboard, and `SIGKILL` after 3 seconds.
3. Clear `serveTarget` and the PIDs. If `tailscale serve --https=443 off` fails (for example, Tailscale's service is not running), keep them, so the next start recognises the leftover as ours and replaces it.

If the dashboard exits on its own, the sidecar turns Serve off as above, records the last output lines as the error, and tries again on the next 30-second check.

Without `CLINE_DESKTOP_CLI_PATH` (some development setups), the status is `unavailable` with "Phone access needs the bundled Cline CLI."

**Why it stops when the app quits.** The dashboard is a separate process from the Hub daemon. Keeping it alive after the app quits would need a second supervisor to restart it, update it and clean up Serve. Tying it to the app gives one simple rule: "phone access works while Cline is open". The Hub daemon keeps its own lifetime.

### 5.5 Port 443 that is already set, crashes and more than one app

Port 443 in Serve is shared by the whole machine. Before starting, the sidecar compares what 443 forwards to with the state file:

1. **Nothing on 443.** Start normally.
2. **Our leftover from a crash.** 443 forwards to the saved `serveTarget`, and the saved `ownerPid` is no longer running, or the saved target no longer answers `GET /`. Stop the saved `dashboardPid` only if it is still running and the saved target still answers, so a process that reused the ID after a reboot is never signalled. Then start normally. Step 3 of the start overwrites the old target.
3. **Another Cline app is running it.** This happens when the stable and Beta apps run side by side; they share the data directory. 443 forwards to the saved `serveTarget`, the saved `ownerPid` is alive and is not this sidecar, and the saved target answers `GET /`. Do not start. The status is `running` with the note "Running from another Cline app", and the same QR code is shown, since the address is the same. When that app quits, it turns Serve off, and the next 30-second check here starts a new one.
4. **Someone else's setting.** 443 forwards anywhere else, or Funnel is on for 443. Change nothing. The status is `blocked` with "Tailscale Serve on port 443 is already used for something else. Remove it with `tailscale serve --https=443 off` if you no longer need it."

A crash followed by a reboot leaves our Serve setting in place, pointing at a closed port. The phone gets an error page until the app opens again and case 2 replaces it.

### 5.6 Commands the webview uses

Added to `sidecar/commands.ts`. Each refuses callers without `canApproveTools`, like `get_hub_status`, because one of them changes Tailscale settings.

| Command | Does |
| --- | --- |
| `get_phone_access` | Returns the current status. With `{ refresh: true }`, checks Tailscale again first. |
| `set_phone_access_enabled` | Saves `enabled`, then starts or stops phone access. |

The status shape, in `webview/lib/phone-access.ts`:

```ts
type PhoneAccessStatus =
	| { state: "off" }
	| {
			state: "setup-needed"
			missing: "install" | "sign-in" | "turned-off" | "magicdns" | "https-certificates" | "operator"
	  }
	| { state: "starting" }
	| { state: "running"; url: string; elsewhere: boolean }
	| { state: "blocked" | "unavailable" | "error"; message: string }
```

`setup-needed` reports the first missing step, in the order of the table in section 5.7.

### 5.7 The Phone access block in settings

A new `phone-access-panel.tsx`, rendered inside `HubPanel` under the existing Hub header, so it reads as part of the **Cline Hub** section. It polls `get_phone_access` every 2 seconds, as `HubPanel` does for the Hub.

- A heading **Phone access** and a `Switch` for on/off, in the same row layout as the other General settings.
- When running:
  - The QR code as SVG, about 200 pixels, drawn dark on a white square so phones can read it in dark mode too.
  - The address as text, with a **Copy link** button.
  - "Tailscale connected", plus "Running from another Cline app" when that applies.
  - One line: "Any device in your Tailscale network can open this and control Cline on this computer."
- When a setup step is missing, one plain message and a **Check again** button, which calls `get_phone_access` with `refresh: true`:

| Missing | Message |
| --- | --- |
| `install` | "Install Tailscale on this computer and your phone to use Cline from your phone." Link to the download page. |
| `sign-in` | "Sign in to Tailscale. On Linux, run `sudo tailscale up`." |
| `turned-off` | "Tailscale is turned off. Turn it on to use Cline from your phone." |
| `magicdns` | "Turn on MagicDNS in the Tailscale admin console." Link to the DNS page. |
| `https-certificates` | "Turn on HTTPS certificates in the Tailscale admin console." Link to the DNS page. |
| `operator` | "Allow Cline to set up Tailscale Serve: run `sudo tailscale set --operator=$USER` once." |

- `blocked`, `unavailable` and `error` show their message in the destructive text style.

### 5.8 QR library

Neither the desktop app nor the hub has a QR library. The plan adds [`uqr`](https://www.npmjs.com/package/uqr) to `apps/examples/desktop-app/package.json`. It is MIT licensed, has no dependencies and has a `renderSVG` function, so the panel needs only a few lines.

`uqr` was approved as a new dependency. The panel shows its SVG output as a `data:` image.

### 5.9 What this replaces

Earlier versions of this plan used one-time pairing codes and per-device cookies, or a room secret in the link with the dashboard bound to the Tailscale IP. This version drops both. Tailscale decides who can reach the computer, Serve provides HTTPS, and the dashboard keeps its default local bind. The cost is that every device in the tailnet can use the dashboard (section 6).

## 6. Security, in plain words

**Your Tailscale network is the only lock.** Any device that can reach this computer through Tailscale can open the dashboard and control Cline. That includes starting sessions and approving shell commands. There is no password, code or secret on top. This covers:

- every device signed in to your tailnet;
- devices of other people in the same tailnet, such as a shared work or family tailnet;
- devices of people you shared this computer with through Tailscale's sharing feature ("shared-in" devices);
- tagged devices, such as servers, if your access rules let them reach this computer.

If anyone other than you can reach this computer through Tailscale, limit it with Tailscale access rules ([ACLs](https://tailscale.com/kb/1018/acls)) or turn phone access off.

**Nobody outside your tailnet can reach it.** The dashboard listens only on `127.0.0.1`. Serve accepts only tailnet devices. People on the same café Wi-Fi, or on the internet, cannot connect.

**Never public.** The app never turns on Funnel, and it refuses to start if Funnel is on for port 443.

**Traffic is encrypted.** The phone talks HTTPS to Serve with a real certificate, and Tailscale encrypts the traffic between devices as well.

**The machine name becomes public.** Turning on HTTPS certificates puts the machine's ts.net name in public certificate logs, as Tailscale's [HTTPS documentation](https://tailscale.com/kb/1153/enabling-https) explains. The name gives no access, but rename the machine first if the name itself is private.

**Other websites cannot use it.** The existing `Host` and `Origin` checks reject requests that start on other websites, even from the phone's own browser.

**Other users of this computer.** The dashboard listens on `127.0.0.1` without a secret, as `cline hub dashboard` does by default today. On a shared computer, another local account could reach it.

**Serve settings are left as found.** The app changes only port 443, only when it is free or already ours, and removes its setting on quit.

## 7. Files to add and change

All paths under `apps/examples/desktop-app/` unless they start with `apps/cline-hub/`.

### 7.1 New files

| File | What it holds |
| --- | --- |
| `sidecar/phone-access.ts` | Tailscale lookup; parsing of `status`, `serve status` and `debug prefs` output (pure functions that take the JSON); the state file; free-port pick; the CLI and Serve arguments; the four port-443 cases; the 30-second check loop; start and stop. The Tailscale runner, the dashboard spawner and the timeouts are passed in, so tests need no real Tailscale; they run small real HTTP servers as dashboards. |
| `sidecar/phone-access.test.ts` | Tests in section 8.1. |
| `webview/lib/phone-access.ts` | `PhoneAccessStatus` type, shared by sidecar and webview (like `webview/lib/hub-status.ts`). |
| `webview/components/views/settings/phone-access-panel.tsx` | The block in section 5.7. |
| `webview/components/views/settings/phone-access-panel.test.tsx` | Tests in section 8.2. |

### 7.2 Changed files

| File | Change |
| --- | --- |
| `sidecar/types.ts` | Add the phone access controller to `SidecarContext`. |
| `sidecar/index.ts` | Create the controller, and start it once Hub startup settles, so the dashboard joins the Hub the app just started instead of racing it. |
| `sidecar/context.ts` | Stop the controller in `disposeSidecarContext`, so Serve is turned off and the dashboard stopped on quit. |
| `sidecar/commands.ts` | The two commands in section 5.6, with the `canApproveTools` check. |
| `sidecar/commands-settings.test.ts` | Both commands refuse an untrusted connection. |
| `webview/components/views/settings/hub-panel.tsx` | Render `<PhoneAccessPanel />` in the Cline Hub section. |
| `webview/components/views/settings/hub-panel.test.tsx` | Stub `PhoneAccessPanel`, so the Hub panel tests stay focused on the Hub. |
| `package.json` | Add `uqr`. |
| `README.md` | A short "Use Cline from your phone" section: the one-time setup in section 3.1, scanning the QR code, and the security points from section 6. |
| `apps/cline-hub/src/server/browser-auth.test.ts` | Pin the Serve contract this design relies on (section 8.3). Test only; no server change. |

## 8. Tests

### 8.1 `sidecar/phone-access.test.ts`

Setup checks, from recorded JSON:

- `Running`, a `DNSName`, non-empty `CertDomains` and a matching `OperatorUser` give "ready" and the URL `https://my-laptop.example-tailnet.ts.net` (trailing dot removed).
- A missing binary, `NeedsLogin`, `Stopped`, an empty `DNSName`, empty `CertDomains` and a different `OperatorUser` each give the matching `missing` value.
- A `tailscale serve` failure that says access was denied gives `operator`.

Commands:

- The dashboard arguments are `hub dashboard --no-open --port <port> --public-url https://<name> --cwd <root>`, with no `--host` and no `--room-secret`.
- The Serve command is `tailscale serve --bg --https=443 http://127.0.0.1:<port>`; the stop command is `tailscale serve --https=443 off`; `reset` is never used.

Port 443 cases, from recorded `serve status` JSON plus the state file:

- Empty: start.
- Our `serveTarget` with a dead `ownerPid`: stop the old `dashboardPid`, start, and overwrite the target.
- Our `serveTarget` with a live `ownerPid` from another process: no start, `running` with `elsewhere: true`.
- A different target, or Funnel on: `blocked`, and no Serve command runs.

Lifecycle, with a fake process runner:

- Ready and enabled: picks a port, spawns once, runs Serve only after `GET /` answers, saves the state, and reports `running`.
- Turning it off, Tailscale going to `Stopped`, and shutdown each run `serve --https=443 off` and then stop the dashboard. If 443 no longer points at our target, `off` is not run.
- A dashboard that exits on its own turns Serve off and reports `error`.
- Shutdown sends `SIGKILL` if the dashboard ignores `SIGTERM`.
- No CLI path gives `unavailable`.
- The state file is created with mode `0600` (skipped on Windows); a corrupt file is replaced.

### 8.2 `phone-access-panel.test.tsx`

- `running`: shows an SVG QR code, the address and **Copy link**; copying writes the address.
- Each `setup-needed` value shows its message and **Check again**, and no QR code. **Check again** calls `get_phone_access` with `refresh: true`.
- `blocked` shows its message.
- The switch calls `set_phone_access_enabled`.

### 8.3 `browser-auth.test.ts`

With `bindHost: "127.0.0.1"`, a local port and `publicUrl: "https://my-laptop.example-tailnet.ts.net"`, and no room secret:

- A WebSocket upgrade with `Host: my-laptop.example-tailnet.ts.net`, `Origin: https://my-laptop.example-tailnet.ts.net` and Serve's `X-Forwarded-*` headers passes.
- The same with `Origin: https://evil.example` fails.

## 9. How to verify

Automated, from `apps/examples/desktop-app`: `bun run typecheck`, `bun run test:sidecar` and `bun run test:settings-ui`. From `apps/cline-hub`: `bun run test`. Then `bun run check` from the repository root.

By hand, on a Linux computer with Tailscale and a phone signed in to the same account:

1. Start with HTTPS certificates off and no operator set. Open the app. The panel asks for HTTPS certificates. Turn them on, press **Check again**; it asks for the operator step. Run `sudo tailscale set --operator=$USER`, press **Check again**; the QR code appears.
2. `tailscale serve status` shows port 443 forwarding to `127.0.0.1:<port>`. `ss -ltn` shows that port bound only on `127.0.0.1`.
3. Scan the QR code. The page loads over HTTPS with a padlock. Open a session, send a message and approve a tool call.
4. Turn off Wi-Fi on the phone and repeat over mobile data.
5. Quit the app. `tailscale serve status` no longer lists port 443, and the dashboard process is gone. Reopen the app; the bookmarked address works again, on a different local port.
6. Kill the sidecar with `kill -9`. `tailscale serve status` still shows the old mapping. Reopen the app; it replaces the mapping and stops the old dashboard.
7. Quit the app, then run `tailscale serve --bg --https=443 http://127.0.0.1:9999`. Open the app; the panel shows the "already used for something else" message and the mapping is unchanged. Remove it with `tailscale serve --https=443 off`.
8. Run `sudo tailscale down`. Within 30 seconds the panel shows "Tailscale is turned off", Serve is off and the dashboard stopped. `sudo tailscale up` brings it back.
9. Turn the switch off, restart the app, and confirm it stays off.
10. Run the Beta app next to the stable app. The second one shows "Running from another Cline app" with the same QR code. Quit the first; within 30 seconds the second takes over.

## 10. Open questions

None.
