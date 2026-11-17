# Features on `local-build`

Everything added on the `local-build` branch that is not on upstream `cline/cline` `main`, as of 2026-11-17 (137 commits). Each item lists the commit(s) that made it.

## Multitask mode (teammates)

- **`/multitask` command** in the CLI and the desktop app. It turns on a mode where the main agent hands work to teammate agents and keeps talking to you while they run. `/multitask <task>` starts it with a task. (`691b4b45e8`, `a80ee6b464`, `a93215233a`, `a244834ed2`, `6084be7d94`, `21d8bcde8b`)
- **The main agent doesn't wait for teammates.** Its turn ends while they keep working, and their results arrive later. (`21d8bcde8b`)
- **Up to 10 teammates at once.** Teammates waiting for a free slot are shown. (`ca968a087e`)
- **Turning Multitask off asks for confirmation**, and clicking the Multitask badge turns it off without clearing your draft. (`ca968a087e`, `a40f018184`)
- **Multitask on/off is saved** and no longer sends repeated "mode changed" notices. (`5e4ddb074a`, `8ffe7e7f46`)
- **With Multitask off, no new teammates or subagents can start.** Results from teammates already running are still delivered when the main agent is idle. (`b9aa05b2b9`, `7de34c1f27`, `5fe36a70fa`)
- **Running teammates are shown even when the main agent is idle.** (`75ed20341e`)
- **Teammate output stays out of the main chat.** Their delivered results are collapsed by default. (`816f75ab04`, `23e19b986a`)
- **Each teammate has its own chat**, updated live and saved after every step. Continuing a teammate reuses its saved conversation. (`32acf2bd3a`, `ee5039677d`, `6dac3e6c14`)
- **Teammate roles:** a read-only teammate stays read-only until its role is changed on purpose, and a role change keeps its history. (`bb14d6e4ce`, `f814a9f21c`)
- **Fixes** for teammate runs that are recovered while a session restarts, and for recording the right process for resumed and teammate sessions. (`96ec4bfbf7`, `bb83ef55c1`)

## Phone access (Cline Hub)

- **Open the Hub dashboard on your phone through Tailscale.** Hub settings show a QR code to scan; it works over plain HTTP, with no extra secret. (`9f551a7abb`, `90b3810cfd`, `d88362b10d`, `d74744b60c`, `7d2c1d2326`)
- **The QR address is kept across restarts**, and two apps sharing the dashboard no longer restart each other in a loop. (`c77991790e`)
- **Subagent sessions are nested under their main session** in the dashboard. (`d679fb25ae`)
- **Session list loads in pages**, and the phone has a thinking-effort picker. (`ff3b604082`)
- **Phone layout:** round menu button, no chat top row, no big titles, same chat order as the desktop sidebar, and it reconnects on its own. Chat controls stay above the keyboard. (`745b8cec69`, `1b44a18128`, `44994eb48d`, `fd8dbc8d89`)
- **See a session's desktop terminals (read-only) from the phone.** (`5496156f6e`)
- **Tool approvals are shared between desktop and phone.** Answer on either one. (`543adc26fc`)
- **Claude Code permission-mode menu on the phone.** (`b516c2e483`)
- **Saved chats reopen on the phone** after a "session not found" error. (`bf77c0017e`)
- **Quitting the desktop app from the tray also stops its local Hub.** (`198ec5223f`)

## Files view

- **Edit the project tree:** new file, new folder, rename, move, delete, and switch the tree between project folders. Open the tree from the welcome screen. (`2afce5c4e3`, `8ac17eb48e`, `ea48467ed2`, `ed03339154`)
- **Copy files and folders** to the system clipboard, and **paste** files and folders from it. (`4e419b9852`, `051c44b155`)
- **Drop files in from outside the app**, with checks so a drop can't overwrite or escape the project. Works with Linux file managers and WebKit drops. (`051c44b155`, `d4845c49e1`)
- **PDF viewer** built on PDF.js, with continuous scrolling and selectable text. (`9109f0d856`, `df5000211a`, `bc4ba130b9`)
- **Markdown preview**, with links to project files that are checked before opening. (`3fab3b1eb5`, `347222af0b`)
- **Image preview** that refreshes when the file changes. (`a81b1273dc`, `9b9ebe6e44`)
- **Edit any local text file** in the viewer, plus a button to reload the open file from disk. (`0c2f865d30`, `28f996efc7`, `c00a547cd1`)
- **Add selected preview text to the chat draft.** (`bc4ba130b9`)
- **Open documents and media in your default app**, not a code editor. (`c57e2b8276`)
- **Each chat remembers its open files.** Tabs stay rendered when switching; only the five most recently viewed stay loaded. (`d4c59e0dbe`, `349b1dc66b`, `0abbfe418f`, `9e0dfffd90`)
- **The Git/Files column can be resized.** (`9dc0950f0d`)
- **Large PDF previews no longer block other replies** from the desktop backend. (`7af5c68c17`)

## Terminal

- **The terminal lives in the right-hand panel** and only shows in the chat it was opened in. Existing shells are kept when a new chat joins a saved terminal group. (`8d50206e25`, `d6a019134e`, `e7e502217f`)
- **Add selected terminal output to the chat draft.** (`53b504dfe8`)
- **Agent shell commands run in the foreground by default**, with a 10-minute timeout instead of 30 seconds. (`a6c74d2bda`)
- **Command output in the chat is kept** when history reloads or later prompts collapse earlier work, and both command and output can be copied. (`962698c3ba`, `77c56dfd41`, `1834da3080`)

## Chat

- **Plan / Act switch** in the desktop chat, applied to idle sessions too. (`62f0fe481c`)
- **Switch git branch** from an idle chat, blocked while it or its teammates are running. (`3f8a3cfe59`)
- **Thinking effort is saved per chat.** The model and effort controls still work in narrow panes. (`b09c698ba8`, `c10ed671a1`)
- **The chat keeps its provider and model** after an app restart. (`3b598856d1`)
- **`@` file mentions** accept names with spaces without quotes, search every attached project folder, and match folder names and full paths. Escape closes the list for good. (`1a08464bfc`, `6a117a5906`, `2c875b78e4`)
- **Select and copy chat text**, including popups. Add selected message text to your draft from a popup. Copy a link's address from a right-click menu. (`b0d66d4148`, `7345b29ebf`, `0d473ffb5b`, `696b14cad4`)
- **Answered questions show the answer you chose.** (`c2e932e6d2`)
- **Approvals and questions wait for you with no time limit.** (`682c8f8ea8`)
- **Forking a session asks for confirmation first.** (`0c99e0f604`, `296eccbc97`)
- **Queued messages:** sending one now interrupts the running tool; a queued message no longer stops the chat; and fixes for prompts sent twice, lost, or shown twice. (`10f942158a`, `5e4b23867a`, `c3cd42327c`, `d0c37a5dd2`, `dec5f28191`, `f90cd4da07`, `cfc128a35d`)
- **Messages sent from another client (e.g. the phone) show up at once.** (`a975e7c0ac`)
- **Reopening a running chat shows its live reply**, including text still streaming. (`8ab4a9268a`, `b5f89bfb30`, `2db366f00d`)
- **Each chat keeps its scroll position** unless new output arrived. (`568b6601b4`)
- **Editing an older message keeps the file viewer and terminal open.** (`426a062305`)
- **Images too large for the model are kept out of requests**, so one oversized image no longer breaks every later turn. (`731d65ce3b`, `8aa1b0d22e`)
- **Photo picking in the chat fixed.** (`296eccbc97`)
- **Speed:** switching chats does less work and reuses unchanged history; long chats render only the newest 30 rows and stop re-rendering on every update. (`9883caf507`, `84fb9ccdf0`, `d391d8da97`, `65cdcaa0b6`, `23ae7fe23d`)

## Sidebar

- **Archive a chat** to hide it from the sidebar but keep all its data. A "Hide archived" filter is on by default. (`d897759e7f`)
- **Collapse the sidebar** with a button. (`2b90aa74e5`)
- **Copy session ID** from the session menus. (`b43cff0840`)
- **Stable order:** chats move to the top when you send, not while the agent is replying. (`6aeb6f0599`, `2f2b4881cd`, `a9698c5130`)
- **Unread marks only for new visible output.** (`412fc185ba`)
- **Times stay visible** and the resize cursor is back. (`adc33165cb`)
- **Agent overview counts match the saved chats.** (`13ce61658e`)

## Claude Code provider

- **Permission-mode menu** in the desktop chat, saved per chat. Unset defaults to Bypass. (`a28ca0b93b`, `1478805853`)
- **Replies stream live** instead of arriving all at once. (`2c06fb9dc1`)
- **Claude Code activity and status output show in the chat**; hook notices are hidden. (`810b4c984c`, `60362506f5`)

## Other

- **Opt-in UI timing recorder** to find pauses in the desktop app, saved through the backend. (`40906e4fea`, `2d0d4c2a83`)
- **Warning when the feature-flag key is missing**, so local builds don't silently look like the account lacks a beta. (`d20ebbcd8f`)
- **New sessions are saved before they are updated** (core fix). (`649d4a1390`)
- **The local `justfile` and root agent instructions are kept out of git.** (`d1ee70cfe9`, `46ebf450cd`)
- **Plans and setup docs:** `apps/cli/docs/multitask-command-plan.md`, `apps/cline-hub/docs/qr-phone-pairing-plan.md`, and phone access setup in `apps/examples/desktop-app/README.md`. (`aa4d8dfe9f`, `ea6386d949`, `f07aa4e68d`, `d5a00e24fc`, `e945247616`, `3b9ec490c0`, `49076c3bce`, `34053a2c76`, `81df4e7e22`)
