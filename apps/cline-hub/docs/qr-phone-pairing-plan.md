# Plan: pair a phone with the Cline Hub dashboard by QR code

Status: proposed. Nothing in this document is implemented yet.

## 1. Goal

A user starts the browser dashboard on their computer. A QR code appears. They scan it with their phone camera. The phone opens the same dashboard and can see and drive their local Cline sessions.

After pairing, the phone must keep working when it is not on the same network as the computer, for example on mobile data. The main way to get there is Tailscale, a private network app that links a user's own devices with encrypted connections wherever they are. The dashboard is reached through Tailscale at a fixed HTTPS address such as `https://my-laptop.example-tailnet.ts.net`.

Same-network access over the local Wi-Fi stays as a second option for users who do not want Tailscale.

This builds on the dashboard that `cline hub dashboard` already starts. No Cline app is needed on the phone; it uses its normal browser, plus the Tailscale app.

## 2. Non-goals

- No change to how Cline Desktop's sidecar checks who may talk to it.
- No full desktop interface on the phone. The phone gets the existing dashboard with small layout fixes.
- No public internet tunnel such as Cloudflare Tunnel or ngrok. The dashboard can approve shell commands on the computer, so it should never have a public address; Tailscale keeps it reachable only from the user's own devices and encrypts traffic end to end.
- No Tailscale Funnel. Funnel is Tailscale's feature for public access, and it has the same problem as a public tunnel.
- No bundled Tailscale. The user installs the Tailscale app themselves.

## 3. How it works for the user

### 3.1 One-time setup (Tailscale mode)

1. Install Tailscale on the computer and on the phone.
2. Sign in to the same Tailscale account on both. Tailscale calls the set of devices under one account a "tailnet".
3. In the Tailscale admin console, turn on MagicDNS (which gives each device a name such as `my-laptop.example-tailnet.ts.net`) and HTTPS certificates (which lets Tailscale issue a real certificate for that name). See [MagicDNS](https://tailscale.com/kb/1081/magicdns) and [HTTPS certificates](https://tailscale.com/kb/1153/enabling-https).

### 3.2 Every time

1. On the computer, run `cline hub dashboard --tailscale`.
2. The terminal prints a QR code and the link it encodes, for example `https://my-laptop.example-tailnet.ts.net/pair/<code>`. The dashboard also opens in the computer's browser as it does today.
3. The user points the phone camera at the QR code and taps the link.
4. The phone opens the dashboard. It stays signed in for 30 days.
5. Later, at home, at work or on mobile data, the user opens the same address on the phone (a bookmark or home-screen icon works). As long as the Tailscale app is connected and the dashboard is running on the computer, it just works.
6. To pair another phone, the user opens **Settings → Phone** in the dashboard on the computer. That page shows a fresh QR code with a countdown, a copy-link button, and the list of paired devices with a revoke button for each.

The link in the QR code works once and only for five minutes. After that it shows a short "this link expired or was already used" page.

### 3.3 Same-network mode

`cline hub dashboard --lan` works the same way, but the QR code holds a local address such as `http://192.168.1.20:8787/pair/<code>`. It needs no setup, and it only works while the phone is on the same network as the computer.

## 4. What exists today

These facts shape the design. Paths are relative to the repository root.

### 4.1 How the dashboard is launched

- `cline hub dashboard` is defined in `apps/cli/src/commands/dashboard-command.ts` (lines 8–47). It accepts `--host`, `--port`, `--public-url`, `--room-secret` and `--no-open`.
- `apps/cli/src/commands/dashboard.ts` turns those flags into environment variables (`HOST`, `CLINE_HUB_DASHBOARD_PORT`, `PUBLIC_URL`, `ROOM_SECRET`; lines 65–94), then imports `startClineHubDashboardServer` from `@cline/cline-hub` (lines 116–119). It prints the URL it opens (lines 164–171).
- From a source checkout, `bun run start` in `apps/cline-hub` runs `apps/cline-hub/src/server.ts`, which prints its own startup lines in `printClineHubDashboardServerInfo` (lines 284–299).

### 4.2 Options

- `apps/cline-hub/src/options.ts` reads `HOST` (default `127.0.0.1`), the port (default `8787`), `PUBLIC_URL` and `ROOM_SECRET` (lines 72–91).
- Any host other than `127.0.0.1`, `localhost` or `::1` counts as "non-local" (lines 64–70). A non-local host without `ROOM_SECRET` makes the server refuse to start (lines 79–83).
- When `HOST` is `0.0.0.0`, the default public URL uses `127.0.0.1` (line 35).
- `buildInviteUrl` adds `?roomSecret=` to the public URL (lines 106–115).
- `apps/cline-hub/src/validate-options.ts` is a small script that checks this parsing (`bun run smoke:options`).
- `apps/cline-hub/src/server/deps.ts` resolves the options once at import time and builds `browserConfig` (lines 7–9, 23–26).

### 4.3 Request checks

`apps/cline-hub/src/server/browser-auth.ts` decides who may use the dashboard. `server.ts` calls it for every request (lines 101–115) and answers `403 unauthorized_browser` on failure.

- A request needs a check if it is a WebSocket upgrade, uses a method other than GET/HEAD/OPTIONS, or asks for a path that is not on the public list (`requiresBrowserRequestAuth`, lines 99–107).
- The public list is the web page routes from `isWebviewRoute` (`apps/cline-hub/src/server/http.ts`, lines 58–82) and a few static files (`server.ts`, lines 61–80). So anyone who can reach the port can load the page itself, but not the live data.
- A checked request must carry a `Host` header on an allowlist and an `Origin` header on an allowlist (`isAuthorizedBrowserRequest`, lines 109–122). This blocks DNS rebinding, where a hostile website points its own domain name at your computer.
- For a non-local bind, the allowlists hold only the public URL and the bind address. The `127.0.0.1`, `localhost` and `[::1]` aliases are added only for local binds (lines 69–73 and 90–94).
- If `ROOM_SECRET` is set, the request URL must also carry `?roomSecret=<secret>` (lines 120–121).
- With the default local bind and no `ROOM_SECRET`, a request with an allowed `Host` and `Origin` passes with no other check. This matters for Tailscale mode; see section 6.
- `apps/cline-hub/src/server/browser-auth.test.ts` covers these rules.

### 4.4 Where the dashboard talks to the server

- All live data moves over one WebSocket at `/browser` (`server.ts`, lines 123–132 and 153–261). The webview opens it in `apps/cline-hub/src/webview/src/vscode.ts` (lines 34–51) and copies `roomSecret` from the page address into the socket address (lines 27–32, 45–48). It builds a `wss:` address when the page is served over HTTPS (line 43), so it already works behind an HTTPS proxy.
- Every action a browser can take arrives as a frame on that socket, including approving tool calls (`approval_response`, `server.ts` lines 210–211) and restarting the hub (lines 245–246).
- `BrowserPeer` in `apps/cline-hub/src/server/types.ts` (lines 56–61) holds per-socket state.

### 4.5 Phone layout today

- `apps/cline-hub/src/webview/index.html` (line 6) and the dev page in `http.ts` (line 100) already set a viewport meta tag.
- The main layout already collapses the sidebar into a top bar below 720 pixels (`apps/cline-hub/src/webview/src/App.tsx`, lines 426–427).
- Settings pages live under `/settings/...` (`App.tsx`, lines 119–126; `apps/cline-hub/src/webview/src/components/views/settings/settings-view.tsx`, lines 36–45). Any `/settings/...` path is already a web page route (`http.ts`, line 80).

### 4.6 Where to keep a secret on disk

`resolveClineDataDir()` in `sdk/packages/shared/src/storage/paths.ts` (lines 186–192) returns `CLINE_DATA_DIR` or `~/.cline/data`. It is exported through `@cline/shared/storage`. The dashboard's `--data-dir` sandbox flag already redirects `CLINE_DATA_DIR` (`apps/cli/src/commands/dashboard.ts`, lines 80–86), so a file under this directory follows the sandbox automatically.

Other code in the SDK already writes private files with `0600` permissions, for example the hub discovery record in `sdk/packages/core/src/hub/discovery/index.ts` (around line 432).

## 5. Tailscale mode

### 5.1 Shape

The dashboard keeps listening only on `127.0.0.1`, as it does by default today. Tailscale Serve sits in front of it.

Tailscale Serve is a feature of the Tailscale app that accepts HTTPS connections from devices in the user's tailnet and forwards them to a local port. It uses the machine's MagicDNS name and a real certificate, so the phone sees `https://<machine>.<tailnet>.ts.net` with a padlock. Nothing listens on the local Wi-Fi, and devices outside the tailnet cannot reach it. See [Tailscale Serve](https://tailscale.com/kb/1312/serve).

The command that sets this up is:

```shell
tailscale serve --https=443 http://127.0.0.1:<port>
```

This is the syntax from Tailscale 1.52 onward, per the [`tailscale serve` command reference](https://tailscale.com/kb/1242/tailscale-serve). Two related commands are used below: `tailscale serve status --json`, which reports the current setup, and `tailscale serve --https=443 off`, which removes the mapping on port 443. `tailscale serve reset` clears every mapping on the machine, so the dashboard never runs it.

Tailscale Serve proxies WebSocket upgrades, so the `/browser` socket works through it unchanged.

### 5.2 Detecting Tailscale

At startup in Tailscale mode, the dashboard runs `tailscale status --json` with a 5-second timeout and reads these fields:

- `BackendState` must be `Running`. Other values such as `NeedsLogin` or `Stopped` mean Tailscale is installed but not signed in or turned off.
- `Self.DNSName` gives the MagicDNS name, for example `my-laptop.example-tailnet.ts.net.`. It ends with a dot, which is stripped.
- `CertDomains` lists the names Tailscale can issue certificates for. If it is empty, HTTPS certificates are off in the admin console.

The `tailscale` command is looked up on `PATH`. On macOS, the CLI that ships inside the Tailscale app is tried too.

### 5.3 When Tailscale is not ready

The dashboard stops before listening and prints one clear message. It does not quietly switch to same-network mode, because that would open a port on the local Wi-Fi the user did not ask for.

| Situation | Message tells the user to |
| --- | --- |
| `tailscale` not found | Install Tailscale, or run with `--lan` for same-network access. |
| `BackendState` is not `Running` | Run `tailscale up` or open the Tailscale app and sign in. |
| `Self.DNSName` empty | Turn on MagicDNS in the admin console (with link). |
| `CertDomains` empty | Turn on HTTPS certificates in the admin console (with link). |
| `tailscale serve` refused for permission | On Linux, run `sudo tailscale set --operator=$USER` once so a normal user can change Serve settings. |
| Port 443 already served by something else | Free it with `tailscale serve --https=443 off`, or set `CLINE_HUB_TAILSCALE_HTTPS_PORT` to another port. |

### 5.4 Who runs `tailscale serve`

Recommendation: the dashboard runs it and removes it on exit.

- One command does everything, which is the point of the QR flow.
- The mapping lives only as long as the dashboard. A mapping left behind would keep forwarding tailnet traffic to port 8787 even after another program takes that port.
- The dashboard already knows the port and can check for conflicts first.

How it works:

1. Read `tailscale serve status --json`. If port 443 already forwards to `http://127.0.0.1:<port>`, reuse it and leave it in place at exit, because the user or an earlier run set it up. If port 443 forwards somewhere else, stop with the message from section 5.3.
2. Start `tailscale serve --https=443 http://127.0.0.1:<port>` as a child process, without `--bg`. Without `--bg`, Tailscale removes the mapping when that command exits and does not restore it after a reboot.
3. On stop, end the child process, then run `tailscale serve --https=443 off` as a safety net.
4. If the child exits early, log its output and stop the dashboard with a clear message.

If the dashboard is killed hard, the child may outlive it. Implementation must check this on each platform. If it does outlive it, the child is started with a small watcher that exits when the parent process is gone.

When the user prefers to manage Serve themselves, `--tailscale --no-serve` skips steps 2 and 3. The dashboard then checks that Serve already forwards to its port and prints the exact `tailscale serve` command if it does not.

### 5.5 Alternative considered: plain HTTP on the Tailscale address

The dashboard could instead bind to the machine's Tailscale address (for example `100.101.102.103`) over plain HTTP, with no Serve and no certificates.

- Simpler: no HTTPS setting in the admin console and no child process.
- Traffic is still encrypted between devices by Tailscale itself.
- But the browser treats the page as "not secure". The cookie cannot be marked `Secure`, and features that need a secure page, such as clipboard writes, may fail.
- The dashboard would listen on a network address, so it goes through the non-local bind path and every tailnet device can reach the port directly.
- The address is a number, not a name, which is harder to read and to recognise.

Tailscale Serve is the better default. The plain-HTTP route is already possible through `--lan --host <100.x address>` for users who cannot turn on HTTPS certificates.

## 6. Telling local requests from proxied ones

### 6.1 The problem

Tailscale Serve forwards each request from the Tailscale app on the same machine. So the dashboard sees every tailnet request arriving from `127.0.0.1`.

Same-network mode trusts requests from the computer itself (section 7.9). If that trust also applied to proxied requests, any device in the tailnet would skip pairing. Tailscale mode must never let that happen.

### 6.2 What Serve adds to a forwarded request

Tailscale's [Serve documentation](https://tailscale.com/kb/1312/serve) and its source code for the proxy show what a forwarded request looks like:

- `Host` stays as the name the phone used, for example `my-laptop.example-tailnet.ts.net`.
- `X-Forwarded-Host` is set to that name. `X-Forwarded-Proto` is `https`. `X-Forwarded-For` carries the phone's Tailscale address.
- For signed-in users, `Tailscale-User-Login`, `Tailscale-User-Name` and `Tailscale-User-Profile-Pic` carry the user's identity. These are missing for devices tagged by an administrator. Serve removes any copies a client sends, so a client cannot fake them through Serve.

### 6.3 The rule

A request counts as **local** only when all of these hold:

- its real network address (from Bun's `server.requestIP(req)`) is loopback: `127.0.0.0/8`, `::1` or `::ffff:127.x.x.x`;
- its `Host` is `127.0.0.1`, `localhost` or `[::1]`, with the dashboard port;
- it has none of `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded` or any `Tailscale-*` header.

Every other request counts as **remote**. Remote requests always need a pairing cookie or the room secret. Only local requests may mint pairing codes, list devices or revoke them.

This is safe because a proxied request can never meet all three conditions: Serve keeps the ts.net name in `Host` and always adds `X-Forwarded-Host`. The only way to send a request that looks local is to run a program on the computer itself, and such a program could already read the Cline data directory.

### 6.4 Tailscale mode turns on checks for local binds

Today, a local bind with no `ROOM_SECRET` lets any request with an allowed `Host` and `Origin` through (section 4.3). In Tailscale mode the bind is local, so that shortcut must be replaced by the rule in section 6.3. Remote requests then go through the cookie check even though the bind is local.

### 6.5 Rate limiting behind the proxy

In Tailscale mode every request comes from `127.0.0.1`, so the `/pair/*` rate limit keys on `X-Forwarded-For` for remote requests. That header is safe to trust here because the dashboard listens only on loopback, so only Serve or a local program can reach it.

### 6.6 Optional hardening: owner-only identity check

The dashboard can read the owner's login at startup from `tailscale status --json` (the `User` entry for `Self.UserID`). It can then reject remote requests whose `Tailscale-User-Login` does not match.

This blocks other people in a shared tailnet, and people the user shared the machine with, even before pairing. It also blocks tagged devices, which carry no identity headers. It is off by default and turned on with `CLINE_HUB_TAILSCALE_OWNER_ONLY=1`, because pairing already guards the dashboard and some users pair a partner's phone on purpose.

## 7. Pairing design

### 7.1 Turning it on

Pairing is off unless asked for. Two new flags on `cline hub dashboard` turn it on:

- `--tailscale` keeps `HOST=127.0.0.1`, sets `CLINE_HUB_PAIRING=tailscale`, and starts Serve (section 5).
- `--lan` binds to `0.0.0.0` (unless `--host` is given) and sets `CLINE_HUB_PAIRING=lan`.

The two flags cannot be used together. From a source checkout, the same variables work with `bun run start`.

`options.ts` gains a `pairing: "off" | "tailscale" | "lan"` field. A non-local host may start when `ROOM_SECRET` is set or pairing is `lan`. Without either, it still refuses to start, as today.

### 7.2 Pairing codes

A pairing code is a one-time ticket that lets one phone sign in.

- Each code is 16 random bytes from `node:crypto`, written as base64url (22 characters). Guessing one is not practical.
- Codes live only in memory, in a `Map` from code to expiry time. A restart forgets them.
- Each code expires after 5 minutes.
- Redeeming a code deletes it, so it works once.
- At most 20 codes can be live. Minting a new one past the cap drops the oldest. Expired codes are swept whenever a code is minted or redeemed.

### 7.3 Who can mint codes

Only a local request, as defined in section 6.3, may mint a code. Minting is a `POST /api/pairing/codes`. Because it is not a GET, it also goes through the normal Host and Origin checks, which stops other websites from minting codes through the user's browser.

### 7.4 Redeeming a code

`GET /pair/:code` is what the phone opens from the QR code.

- If the code is valid, the server creates a device record, sets a cookie and redirects to `/`.
- If the code is unknown, expired or already used, the server answers `410` with a small HTML page. The page says the link expired or was already used, and to open **Settings → Phone** on the computer for a new one.
- The `Host` header must still be on the allowlist, so a code cannot be redeemed through a rebinding domain.
- The response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the code does not linger in caches or leak to other sites.

`/pair/` is added to the public route check in `server.ts` so the request reaches the handler without a cookie.

### 7.5 The session cookie

The cookie proves that a phone was paired.

- Name: `cline_hub_session_<port>`. Browsers send cookies to every port on the same host, so the port in the name keeps two dashboards apart. OpenCode does the same.
- Flags: `HttpOnly` (page scripts cannot read it), `SameSite=Lax` (the browser does not send it on requests that other sites start in the background), `Path=/`, `Max-Age` of 30 days.
- `Secure` (the browser only sends it over HTTPS) is set when the redeem request arrived over HTTPS, which the server learns from `X-Forwarded-Proto: https` on a proxied request. In Tailscale mode that is always true. In same-network mode it is plain HTTP, so `Secure` is not set.
- Value: `<deviceId>.<expiry>.<signature>`.
  - `deviceId` is 9 random bytes in base64url.
  - `expiry` is a Unix time in seconds, 30 days ahead.
  - `signature` is HMAC-SHA256 over `<deviceId>.<expiry>`, in base64url. HMAC is a keyed fingerprint: only someone with the server key can produce a matching one.

A browser stores a cookie under the host name it visited. In Tailscale mode that name is the machine's MagicDNS name, which does not change when the phone or the computer moves between networks. So one pairing keeps working everywhere.

The approved format was `<expiry>.<HMAC>`. This plan adds the device id in front. Without it, the server cannot tell devices apart, so it could not list them or revoke one. Rotating the key still revokes all of them at once.

Checking a cookie:

1. Split into three parts. Reject anything else.
2. Reject if the expiry is not a whole number or is in the past.
3. Recompute the signature and compare with `crypto.timingSafeEqual`, after checking lengths match. A constant-time compare does not leak how many characters matched.
4. Reject if the device id is not in the device list. This is how revoking one device works.

### 7.6 The server key and device list on disk

- File: `<Cline data dir>/hub/dashboard-pairing.json`, using `resolveClineDataDir()` from `@cline/shared/storage`.
- Content: `{ "version": 1, "key": "<32 random bytes, base64url>", "devices": [{ "id", "userAgent", "tailscaleLogin", "createdAt", "lastSeenAt" }] }`. `tailscaleLogin` is copied from `Tailscale-User-Login` at redeem time when present, so the device list can show whose phone it is.
- The directory is created with mode `0700` and the file is written with mode `0600` through a temporary file and a rename, as the hub discovery record does.
- The file is created the first time pairing starts. If it cannot be parsed, it is replaced with a fresh one, which signs out every device.
- `lastSeenAt` is updated in memory when a paired socket opens and written to disk at most once a minute.

### 7.7 Which requests the cookie unlocks

The cookie is checked only where `requiresBrowserRequestAuth` already demands a check: the `/browser` WebSocket upgrade, non-GET requests and non-public GETs.

A request with a valid cookie passes when:

- its `Host` is on the allowlist, and
- its `Origin` header is absent, or the host part of `Origin` equals `Host`.

The Origin rule blocks CSWSH (cross-site WebSocket hijacking, where a page on another site opens a socket to your dashboard and the browser attaches your cookie) and CSRF (where another website tricks the browser into sending a request). Browsers always send `Origin` on WebSocket upgrades and on cross-site POSTs, so an absent `Origin` only comes from non-browser tools such as `curl`, which would need the cookie value itself.

When the socket opens, the device id is stored on `BrowserPeer` so a revoke can close that phone's open socket at once.

### 7.8 Allowed hosts and origins

The allowlists in `browser-auth.ts` grow by mode:

- **Tailscale mode:** the MagicDNS name, for example `my-laptop.example-tailnet.ts.net` as a host and `https://my-laptop.example-tailnet.ts.net` as an origin. If `CLINE_HUB_TAILSCALE_HTTPS_PORT` is not 443, both carry that port. The loopback aliases stay, for the computer's own browser.
- **Same-network mode:** every address picked by the LAN address selection in section 8.2, with the port, plus the loopback aliases, which today are only added for local binds.

This keeps the DNS rebinding protection: a hostile domain name never appears on the list.

`PUBLIC_URL` stays a loopback address in both modes, because the CLI opens it in the computer's browser. The phone's address is kept in a separate field.

### 7.9 The computer's own browser

A local request (section 6.3) whose `Origin` is on the allowlist passes without a cookie or room secret, in both modes. This is the same trust that local-only mode gives today. It lets the computer's browser open the dashboard and mint codes without pairing itself.

### 7.10 ROOM_SECRET keeps working

`?roomSecret=` keeps working unchanged for scripts and for people who already use it. When both are set, a request passes with either a valid cookie or the right room secret. The README states that the cookie is the recommended way for phones.

### 7.11 Rate limit on `/pair/*`

A failed redemption counts against the caller: `X-Forwarded-For` in Tailscale mode (section 6.5), the network address in same-network mode. After 10 failures in one minute, that caller gets `429` for the rest of the minute. Codes are too long to guess, so this is a cheap extra guard, not the main defence. The counters live in memory and are capped at 1,000 callers.

### 7.12 Device list, revoke one, sign out all

All of these accept only local requests, like minting:

- `GET /api/pairing/devices` returns the device list.
- `DELETE /api/pairing/devices/:id` removes one device and closes its open sockets.
- `POST /api/pairing/devices/revoke-all` replaces the key and clears the list. Every cookie stops working and every paired socket is closed.

A public `GET /api/pairing/status` returns `{ pairing, paired, local }` for the caller. The webview uses it to decide whether to show the **Phone** settings page and what to say when the socket is refused. It reveals nothing else.

## 8. QR code

### 8.1 What the QR code holds

A plain link, so phone cameras open it directly:

- Tailscale mode: `https://<machine>.<tailnet>.ts.net/pair/<code>`, with `:<port>` added when the Serve port is not 443.
- Same-network mode: `http://<lan-ip>:<port>/pair/<code>`.

### 8.2 Picking the LAN address (same-network mode)

A new module reads `os.networkInterfaces()` and ranks the addresses. The function takes the interface list as input so it can be tested without a real network.

- Keep IPv4 addresses that are not internal.
- Prefer private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, then `100.64.0.0/10` (used by carrier networks and Tailscale).
- Skip link-local `169.254.0.0/16`.
- Skip virtual bridges by interface name: `docker*`, `br-*`, `veth*`, `vmnet*`, `vboxnet*`, `virbr*`, `utun*`, `awdl*`, `llw*`.
- If `--host` names a specific address, use only that one.
- If several remain, the terminal prints the QR for the first and lists the others as plain links. The **Phone** page shows a picker.

### 8.3 Terminal QR at startup

When pairing is on, the server mints one code at startup. Both `printClineHubDashboardServerInfo` in `server.ts` and `runDashboardCommand` in `apps/cli/src/commands/dashboard.ts` print the QR code and the link under it. The QR is drawn with half-block characters (`▀`, `▄`, `█`), which fit two rows of the code into one line of text. A line under it says the code expires in 5 minutes and that **Settings → Phone** gives a new one.

To support this, `ClineHubDashboardServer` (in `server.ts`) and `DashboardServerHandle` (in `dashboard.ts`) gain an optional `pairing` field with `{ mode: "tailscale" | "lan"; url: string; otherUrls: string[]; expiresAt: number }`.

### 8.4 The "Phone" page in the dashboard

A new settings section at `/settings/phone`, shown only when `GET /api/pairing/status` reports pairing on and a local caller.

- A QR code for a fresh code, drawn as SVG.
- A countdown to expiry. When it ends, the page mints a new code. A **Refresh** button does the same at any time.
- The link as text with a **Copy link** button.
- In Tailscale mode, a reminder that the phone needs the Tailscale app connected. In same-network mode, an address picker when there are several addresses.
- The device list: user agent, Tailscale login when known, paired date, last seen. Each row has **Revoke**. Below the list, **Sign out all devices**.

The webview calls the HTTP endpoints from section 7 with `fetch`. Same-origin `fetch` sends the `Origin` header, so the existing checks apply.

### 8.5 Choice of QR encoder

| Option | Size | Notes |
| --- | --- | --- |
| npm `qrcode` | Several dependencies | Mature. Adds dependencies to the hub and to the CLI bundle. |
| npm `qrcode-terminal` | Small | Terminal only; the webview would need a second library. |
| Adapt OpenCode's `packages/util/src/qr.ts` | One file, about 320 lines, no dependencies | Byte mode, error correction level L. Returns rows of booleans, so the same code draws both the terminal QR and the SVG. MIT licensed. |

Recommendation: adapt OpenCode's encoder into `apps/cline-hub/src/qr.ts`. It adds no dependency, it serves both the terminal and the webview, and the webview can import it the same way it already imports `apps/cline-hub/src/webview-protocol.ts`. Adding an npm package instead would be a dependency change and needs separate approval.

## 9. Phone usability

Only small fixes:

- Add `viewport-fit=cover` to the viewport tag in `apps/cline-hub/src/webview/index.html` and the dev page in `http.ts`, and pad the top bar and composer with `env(safe-area-inset-*)` so notches do not cover them.
- Check the composer, session list and approval prompts at 375 pixels wide. Fix overflow with Tailwind classes where needed, using the existing `max-[720px]:` pattern from `App.tsx`.
- Make the composer text at least 16 pixels on narrow screens, so iOS does not zoom in when it gets focus.
- When the socket is refused, the webview calls `GET /api/pairing/status`. If pairing is on and the device is not paired, it shows "This device is not paired. Scan the QR code on your computer." instead of the generic connection error in `vscode.ts` (lines 76–81).
- When the socket drops, the webview already shows a disconnected status. In Tailscale mode the message adds "Check that Tailscale is connected on this phone and the dashboard is running on your computer."

## 10. Optional: a button in Cline Desktop

A button in Cline Desktop could start the dashboard in Tailscale mode and show the QR. It is not worth doing in the first version. Cline Desktop runs its own sidecar backend (see `apps/examples/desktop-app`), so the button would have to spawn and supervise a separate dashboard process and its Tailscale Serve child, track the port and stop both on exit. The terminal command and the **Phone** page cover the need. Revisit if users ask for it.

## 11. Files to add and change

### 11.1 New files

| File | What it holds |
| --- | --- |
| `apps/cline-hub/src/server/pairing.ts` | Code minting and redemption, cookie signing and checking, the device list file and the rate limiter. Carries the MIT notice for the parts adapted from OpenCode. |
| `apps/cline-hub/src/server/pairing.test.ts` | Unit tests for the above. |
| `apps/cline-hub/src/server/tailscale.ts` | Runs and parses `tailscale status --json` and `tailscale serve status --json`, builds the Serve command, starts and stops the Serve child process, and turns failures into the messages in section 5.3. Parsing is in pure functions that take the JSON as input. |
| `apps/cline-hub/src/server/tailscale.test.ts` | Unit tests for status parsing, conflict detection and messages, using recorded JSON fixtures. |
| `apps/cline-hub/src/server/lan-address.ts` | Ranks `os.networkInterfaces()` output and builds same-network pairing links. |
| `apps/cline-hub/src/server/lan-address.test.ts` | Unit tests for address ranking. |
| `apps/cline-hub/src/qr.ts` | QR encoder adapted from OpenCode, plus `renderTerminalQr(rows)` and `renderSvgPath(rows)`. Carries the MIT notices for OpenCode and Project Nayuki. |
| `apps/cline-hub/src/qr.test.ts` | Unit tests for the encoder. |
| `apps/cline-hub/src/smoke-pairing.ts` | End-to-end smoke script, run with `bun run smoke:pairing`. |
| `apps/cline-hub/src/webview/src/components/views/settings/phone-view.tsx` | The **Phone** settings page. |

### 11.2 Changed files

| File | Change |
| --- | --- |
| `apps/cline-hub/src/options.ts` | Add `pairing` from `CLINE_HUB_PAIRING`, the Serve port from `CLINE_HUB_TAILSCALE_HTTPS_PORT`, the `--no-serve` choice, the owner-only switch, and `CLINE_HUB_TAILSCALE_HOST`, which sets the MagicDNS name directly and skips detection (used by the smoke script). Allow a non-local host when pairing is `lan`. |
| `apps/cline-hub/src/validate-options.ts` | Cases for each pairing mode, with and without `ROOM_SECRET`, and for `--tailscale` with a non-local host (rejected). |
| `apps/cline-hub/src/server/deps.ts` | Export the pairing settings. Add `pairing` to `browserConfig`. |
| `apps/cline-hub/src/server/types.ts` | `BrowserConfig.pairing`; `BrowserPeer.deviceId?`. |
| `apps/cline-hub/src/server/browser-auth.ts` | Add `classifyRequest` (local or remote, section 6.3). Accept a pairing cookie check and the caller address in the options. Replace the local-bind shortcut with the local/remote rule when pairing is on. Add the MagicDNS name or LAN addresses and the loopback aliases to the allowlists by mode. Keep the room secret path unchanged. |
| `apps/cline-hub/src/server/browser-auth.test.ts` | Cases from section 12.1. |
| `apps/cline-hub/src/server.ts` | In Tailscale mode, detect Tailscale and start Serve before listening; stop it in `stop()`. Load the pairing store. Add `/pair/` and `/api/pairing/status` to the public routes. Handle `/pair/:code` and `/api/pairing/*`. Pass `server.requestIP(req)` into the checks. Store the device id on the peer. Mint the startup code and print the QR. Add `pairing` to the returned handle. |
| `apps/cline-hub/src/server/http.ts` | A small `createHtmlResponse` helper for the expired-link page. `viewport-fit=cover` in the dev page. |
| `apps/cline-hub/src/webview/index.html` | `viewport-fit=cover`. |
| `apps/cline-hub/src/webview/src/vscode.ts` | On socket failure, ask `/api/pairing/status` and show the "not paired" or "check Tailscale" message. |
| `apps/cline-hub/src/webview/src/components/views/settings/settings-view.tsx` | Add the **Phone** section to `navCategories` and render `phone-view.tsx`, only when allowed. |
| `apps/cline-hub/src/webview/src/App.tsx` | Add `Phone: "/settings/phone"` to `SETTINGS_SECTION_PATHS`. Safe-area padding and narrow-screen fixes. |
| `apps/cline-hub/package.json` | Add the `smoke:pairing` script. No new dependencies. |
| `apps/cline-hub/README.md` | A "Use it from your phone" section: Tailscale setup first, same-network mode second, and the security notes from section 13. |
| `apps/cli/src/commands/dashboard-command.ts` | Add `--tailscale`, `--no-serve` and `--lan`, with an error if `--tailscale` and `--lan` are both given. |
| `apps/cli/src/commands/dashboard.ts` | Map the new flags to environment variables. Print the QR and link from `server.pairing`. |
| `apps/cli/src/commands/dashboard.test.ts` | Check the flag mapping, the conflict error, and that the QR is printed when `pairing` is present. |

## 12. Tests

Hub unit tests run with Vitest under Node (`apps/cline-hub/vitest.config.ts`), so they cannot use `Bun.serve`. Unit tests therefore cover pure functions, and the smoke script covers the real server.

### 12.1 Unit tests

`browser-auth.test.ts`, local or remote:

- Loopback address, `Host: 127.0.0.1:8787`, no forwarding headers: local.
- Loopback address, `Host: my-laptop.example-tailnet.ts.net`: remote.
- Loopback address, `Host: 127.0.0.1:8787`, plus any one of `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded` or `Tailscale-User-Login`: remote.
- Non-loopback address with a loopback `Host`: remote.

`browser-auth.test.ts`, access:

- A proxied request in Tailscale mode with no cookie is refused, even though it comes from loopback and the bind is local.
- A proxied request with a valid cookie and `Origin: https://my-laptop.example-tailnet.ts.net` passes.
- A valid cookie with a foreign `Origin` fails, for both a WebSocket upgrade and a POST.
- A valid cookie with a `Host` not on the allowlist fails.
- A LAN address `Host` passes in same-network mode and fails in Tailscale mode and with pairing off.
- With owner-only on, a proxied request with a different `Tailscale-User-Login`, or none, is refused.
- The existing room secret and local-only cases still pass unchanged when pairing is off.

`pairing.test.ts`:

- A minted code redeems once; a second redeem fails.
- A code fails after 5 minutes (pass the current time in rather than waiting).
- An unknown code fails.
- The live code cap drops the oldest code.
- A token signs and checks; a token with a changed expiry, device id or signature fails; an expired token fails; a token with the wrong number of parts fails.
- A token for a revoked device fails. After revoke-all, every old token fails.
- The cookie carries `Secure` when the redeem request had `X-Forwarded-Proto: https`, and not otherwise.
- The rate limiter keys on `X-Forwarded-For` for remote requests, blocks after 10 failures in a minute and clears after the minute.
- The device file is created with mode `0600` (skipped on Windows).

`tailscale.test.ts`:

- Status JSON with `BackendState: "Running"`, a `Self.DNSName` and a non-empty `CertDomains` gives the name without its trailing dot.
- `NeedsLogin`, an empty `DNSName` and empty `CertDomains` each give their message from section 5.3.
- Serve status with port 443 forwarding to our port is reused; forwarding elsewhere is a conflict; no entry means start Serve.
- The built command is `tailscale serve --https=443 http://127.0.0.1:<port>`, and uses the custom port when set.

`lan-address.test.ts`:

- `192.168.x`, `10.x` and `172.16–31.x` rank before `100.64/10`.
- `169.254.x`, internal addresses and IPv6 are dropped.
- `docker0`, `br-1234`, `veth…`, `vmnet1` and `utun3` are dropped.
- An explicit `--host` address wins.
- `PUBLIC_URL` replaces the LAN address in the link.

`qr.test.ts`:

- A short link encodes to a version-2 or version-3 symbol of the expected size.
- The three corner finder patterns are present.
- The terminal renderer produces half as many lines as there are rows, plus the quiet zone.

### 12.2 Smoke script

`bun run smoke:pairing` starts the real dashboard on a spare port, with `CLINE_DATA_DIR` set to a fresh temporary directory so it never touches the user's state. It runs in Tailscale mode with `--no-serve` and `CLINE_HUB_TAILSCALE_HOST=test.example-tailnet.ts.net`, which skips detection, so it needs no Tailscale install. It simulates Serve by sending requests to `127.0.0.1` with `Host: test.example-tailnet.ts.net`, `X-Forwarded-Host`, `X-Forwarded-Proto: https` and `X-Forwarded-For: 100.64.0.2`. It then:

1. Mints a code with `POST /api/pairing/codes` as a local request. Expect `200` and a code.
2. Tries to mint as a simulated proxied request. Expect `403`.
3. Redeems the code as a proxied request. Expect `302` to `/` and a `Set-Cookie` header with `Secure` and `HttpOnly`.
4. Redeems the same code again. Expect `410`.
5. Opens `/browser` as a proxied WebSocket without the cookie. Expect it to be refused, even though it comes from loopback.
6. Opens `/browser` as a proxied WebSocket with the cookie and `Origin: https://test.example-tailnet.ts.net`. Expect it to open and answer a `ready` frame.
7. Repeats step 6 with `Origin: https://evil.example`. Expect it to be refused.
8. Revokes the device as a local request, then retries step 6. Expect it to be refused.
9. Restarts in same-network mode and repeats steps 1, 3, 5 and 6 against the machine's LAN address, without forwarding headers and without `Secure` on the cookie.

The README lists the same steps as `curl` commands for manual checks.

### 12.3 Manual checks on a real phone

1. Tailscale mode on the same Wi-Fi: run `cline hub dashboard --tailscale`, scan with an iPhone and an Android phone, open a session, send a message and approve a tool call.
2. Tailscale mode on mobile data: turn off Wi-Fi on the phone, open the bookmarked address, and repeat the same actions.
3. Revoke the phone from the computer and confirm the phone disconnects.
4. Stop the dashboard and confirm `tailscale serve status` no longer lists the mapping.
5. Each failure message in section 5.3: log out of Tailscale, turn off HTTPS certificates in a test tailnet, and occupy port 443 with another Serve mapping.
6. Same-network mode: run `cline hub dashboard --lan` and repeat check 1.

## 13. Security risks and mitigations

**A paired phone has full control.** It can start sessions, approve shell commands and restart the hub, the same as the computer's browser. Mitigations: pairing needs a look at the computer's screen; devices can be revoked one by one or all at once; the README says this plainly. A read-only phone mode is out of scope for this version.

**Proxied requests looking local.** Tailscale Serve forwards from `127.0.0.1`, so a naive loopback check would let every tailnet device skip pairing. Mitigation: the local/remote rule in section 6.3, which also checks `Host` and forwarding headers, with unit tests and a smoke step for exactly this case.

**Who else is in the tailnet.** Tailscale Serve is reachable by every device the tailnet's access rules allow, and by people the user shared the machine with. Mitigations: those devices still need a pairing cookie; the README advises a personal tailnet or access rules that limit the machine to the user; the optional owner-only check in section 6.6 blocks other logins outright.

**Funnel.** If the user later runs `tailscale funnel` on the same port, the dashboard becomes public. Mitigations: the dashboard only ever runs `tailscale serve`; at startup it refuses to run if `tailscale serve status --json` shows Funnel turned on for its port; the README says never to use Funnel with it.

**HTTPS certificates publish the machine name.** Turning on HTTPS certificates puts the machine's ts.net name in public certificate logs, as Tailscale's [HTTPS documentation](https://tailscale.com/kb/1153/enabling-https) explains. The name reveals the machine and tailnet names but gives no access. The README mentions this so users can rename the machine first if they wish.

**Plain HTTP in same-network mode.** Anyone who can watch traffic on the same Wi-Fi can read the pairing link and the cookie, and with the cookie they can drive the dashboard. Mitigations: the link is single-use and short-lived; the cookie can be revoked; the README recommends Tailscale mode and says to use `--lan` only on trusted networks. Tailscale mode does not have this problem: traffic is HTTPS and also encrypted by Tailscale.

**Someone sees the QR code over your shoulder.** A photo of the screen gives a working link for up to 5 minutes. In Tailscale mode the photo is only useful to a device in the same tailnet. Mitigations: the link works once, so if the user's own phone redeems it first the photo is useless; every paired device is listed with revoke.

**CSRF and CSWSH.** Another website could try to make the phone's browser send requests or open a socket to the dashboard. Mitigations: `SameSite=Lax` keeps the cookie off background cross-site requests, and the server rejects any cookie request whose `Origin` does not match `Host`.

**DNS rebinding.** A hostile site could point its own domain at the computer's address. Mitigation: the `Host` allowlist stays in force for every checked request and for `/pair/`.

**Guessing codes or cookies.** Codes carry 128 random bits; cookies carry a 256-bit-key HMAC. Mitigations: the rate limit on `/pair/*` and the constant-time compare.

**Leftover Serve mapping.** A mapping left after a crash would forward tailnet traffic to whatever later takes the port. Mitigations: Serve runs without `--bg`, so it does not survive a reboot; the dashboard removes it on stop; the child watcher in section 5.4 covers hard kills.

**Accidental exposure in same-network mode.** Binding to `0.0.0.0` on a laptop that later joins a café network exposes the port there. Mitigations: same-network mode is off unless `--lan` is passed; nothing works without a cookie, a room secret or a local caller; the terminal prints which addresses are listening. Tailscale mode never binds beyond loopback.

**Other users on the same computer.** Local requests are trusted, as in local-only mode today. On a shared computer, another local user could reach the dashboard. This is unchanged from today's default and is noted in the README.

**The key file.** Anyone who can read `dashboard-pairing.json` can forge cookies. Mitigation: `0600` permissions in a `0700` directory, so only the user's own account can read it.

## 14. Limitations

- Tailscale mode needs the Tailscale app installed, signed in and connected on the phone. On iOS and Android, Tailscale uses the phone's VPN slot, so it cannot run alongside another VPN app.
- Tailscale mode needs MagicDNS and HTTPS certificates turned on in the tailnet. Users who cannot turn on certificates can use `--lan --host <Tailscale address>` over plain HTTP instead (section 5.5).
- On Linux, a normal user may need a one-time `sudo tailscale set --operator=$USER` before the dashboard can start Serve.
- The computer must be awake, connected and running the dashboard. Closing the terminal stops it, and the phone loses its connection.
- Same-network mode only works on the same network. If the computer's local address changes, the browser keeps the cookie under the old address, so the phone must scan a new QR code.
- In same-network mode, browsers treat the page as not secure, so features that need a secure page, such as clipboard writes, may not work on the phone.
- Pairing codes are in memory, so restarting the dashboard voids unredeemed codes. Paired phones stay paired.

## 15. Reusing OpenCode's implementation

OpenCode solved the same pairing problem and is MIT licensed. These upstream files are worth reading and, where noted, adapting. All paths are on the `dev` branch of [anomalyco/opencode](https://github.com/anomalyco/opencode).

- [`packages/server/src/pairing.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/pairing.ts): 16-byte base64url codes, 5-minute lifetime, capped cache, consume-once. The logic is short; it is rewritten here without Effect.
- [`packages/server/src/auth.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/auth.ts): the `<expiry>.<signature>` token, 30-day lifetime, constant-time check, and the port in the cookie name. OpenCode derives its key from the server password; this plan uses a random key file instead and adds a device id.
- [`packages/server/src/middleware/authorization.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/middleware/authorization.ts): the rule that a cookie only counts when `Origin` is absent or matches `Host`.
- [`packages/server/src/handlers/server.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/handlers/server.ts): the redeem handler that sets the `HttpOnly`, `SameSite=Lax` cookie and redirects to `/`, and the expired-link message.
- [`packages/server/src/server-info.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/server/src/server-info.ts): listing reachable addresses from `networkInterfaces()` when bound to `0.0.0.0`. This plan adds ranking and bridge filtering on top for same-network mode.
- [`packages/util/src/qr.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/util/src/qr.ts): the dependency-free QR encoder. It is adapted almost as is.

OpenCode has no Tailscale integration; sections 5 and 6 are new.

License notice: this repository is Apache-2.0, and MIT code may be included in it. Any file that copies or closely adapts OpenCode code must keep OpenCode's copyright line and the MIT permission notice from its [LICENSE](https://github.com/anomalyco/opencode/blob/dev/LICENSE) in a header comment. `qr.ts` must also keep the existing credit to Project Nayuki's QR Code generator, which is MIT licensed too. Files that only follow the same idea, without copying code, need no notice, but a one-line credit is still courteous.

## 16. References

- Tailscale Serve: <https://tailscale.com/kb/1312/serve>
- `tailscale serve` command: <https://tailscale.com/kb/1242/tailscale-serve>
- Tailscale CLI: <https://tailscale.com/kb/1080/cli>
- MagicDNS: <https://tailscale.com/kb/1081/magicdns>
- HTTPS certificates: <https://tailscale.com/kb/1153/enabling-https>

## 17. Steps

Each step ends with a check. Rough effort is for one developer who knows the codebase.

1. **Options and CLI flags.** Add `pairing` and the Tailscale settings to `options.ts`, and `--tailscale`, `--no-serve` and `--lan` to the CLI. → verify: `bun run smoke:options` passes with the new cases; `bun -F @cline/cli test` passes the updated `dashboard.test.ts`; `HOST=0.0.0.0` without `ROOM_SECRET` or `--lan` still refuses to start. *About 3 hours.*
2. **Pairing core.** Write `pairing.ts`: codes, tokens, device file, rate limiter. → verify: `pairing.test.ts` passes with `bun run test` in `apps/cline-hub`. *About 1 day.*
3. **Request checks.** Add `classifyRequest` and extend `browser-auth.ts` with the cookie rule, local trust and the per-mode allowlists. → verify: the new and existing `browser-auth.test.ts` cases pass, including "proxied request from loopback without cookie is refused". *About 1 day.*
4. **Tailscale integration.** Write `tailscale.ts`: status parsing, conflict and Funnel checks, the Serve child process and clean-up. → verify: `tailscale.test.ts` passes; on a machine with Tailscale, starting and stopping the dashboard adds and removes the mapping in `tailscale serve status`; killing the dashboard hard leaves no mapping. *About 1 day.*
5. **LAN address and QR.** Write `lan-address.ts` and adapt `qr.ts`. → verify: their unit tests pass; a small throwaway call prints a QR in the terminal that a phone camera reads. *About half a day.*
6. **Server routes.** Wire `/pair/:code`, `/api/pairing/*`, Tailscale start-up, the startup code and the terminal QR into `server.ts` and `dashboard.ts`. → verify: `bun run smoke:pairing` passes all nine steps. *About 1 day.*
7. **Phone page and phone fixes.** Add `phone-view.tsx`, the settings entry, the "not paired" and "check Tailscale" messages and the layout fixes. → verify: `bun run build:webview` succeeds; the page shows on `127.0.0.1` and is hidden through the ts.net address; the manual checks in section 12.3 pass, including mobile data. *About 1 day.*
8. **Docs and full check.** Update the README with Tailscale setup first and same-network mode second. → verify: `bun run check` passes from the repository root. *About 3 hours.*

Total: about 6 to 7 days, up from 4 to 5 days in the same-network-only version of this plan.
