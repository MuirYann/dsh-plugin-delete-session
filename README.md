# dsh-session-delete

**A real delete for DSH sessions.** Adds a red **Delete session** row to a session's `...` menu and removes the session for good — its log, its projection cache record, and its workspace accounting.

DSH can archive a session but never delete one. `archiveSession` is the only session-level mutation the Host exposes, and the workspace registry's `delete` removes a *workspace registration* while deliberately retaining every session log. This plugin adds the missing action as an out-of-tree bundle: **no DSH source file and nothing inside the installation is modified.**

```
 ⋯  Session menu
 ├─  Pin session
 ├─  Rename                  Ctrl + Alt + G
 ├─  Fork session            Ctrl + Alt + F
 ├─  Archive session         Ctrl + Shift + A
 └─  Delete session          ←─ this plugin
```

---

## Contents

- [Requirements](#requirements)
- [Install](#install)
  - [From the in-app dialog](#from-the-in-app-dialog)
  - [From a local checkout](#from-a-local-checkout)
- [Usage](#usage)
- [What a delete removes](#what-a-delete-removes)
- [Safety rules](#safety-rules)
- [Permissions and data access](#permissions-and-data-access)
- [Disable or uninstall](#disable-or-uninstall)
- [How it works](#how-it-works)
- [HTTP interface](#http-interface)
- [Development notes](#development-notes)
- [License](#license)

---

## Requirements

| | |
|---|---|
| **DSH** | A profile that mounts `@deepseek-ai/dsh-host-webserver` and the session-menu slot — the shipped `desktop` and `web` profiles both qualify. |
| **Node** | None extra. The package has **no dependencies and no build step**; `lib/*.js` are the shipped sources. |
| **Credentials** | None. It authenticates with the DSH page's own same-origin session cookie. |

## Install

The plugin installs as a **profile bundle**. That matters: a row written directly into the profile's `cordis.patch.yml` becomes a *ledger item*, which the Plugins page renders inside the **Official** group beside the built-in plugins and which cannot be enabled, configured, or uninstalled on its own. A bundle appears under **Installed** with its own card, switch, and detail page.

### From the in-app dialog

Open **Plugins → Add plugin** and paste either form:

```text
github:PotatoOfPotato/dsh-plugin-delete-session
https://github.com/PotatoOfPotato/dsh-plugin-delete-session
```

DSH installs it into the profile, finds `dsh.bundle.patch` in its manifest, and adds it to `dsh.profile.bundles`. **Restart DSH** — profiles compose at startup.

### From a local checkout

```sh
git clone https://github.com/PotatoOfPotato/dsh-plugin-delete-session
```

Then in `<DSH_HOME>/profiles/<profile>/`:

**1.** Add the dependency and select the bundle in `package.json`:

```json
{
  "dependencies": {
    "dsh-session-delete": "link:/absolute/path/to/dsh-plugin-delete-session"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-session-delete"
      ]
    }
  }
}
```

**2.** Install and restart:

```sh
pnpm install --dir <DSH_HOME>/profiles/<profile>
```

`<DSH_HOME>` defaults to `~/.dsh` (`%USERPROFILE%\.dsh` on Windows).

## Usage

Open a session's `...` menu, choose **Delete session**, and confirm the dialog naming that session. The row leaves the sidebar immediately — no page reload.

## What a delete removes

| Artifact | Path |
|---|---|
| **Session directory** — the lock file and every log generation, historical format versions included | `<DSH_HOME>/sessions/<encoded-cwd>/<session-id>/` |
| **Projection cache record** | `<DSH_HOME>/storages/session_projcache/sessions/<id>.json` |
| **Workspace accounting** — dropped from every `tables.workspaces[*].sessionIds`, plus the global `archivedSessionIds` and `pinnedSessionIds` | `<DSH_HOME>/storages/workspace.json` |

The session directory is located by scanning for the id as a directory name rather than recomputing the lossy workspace-path encoding, so it is found whichever project directory holds it.

The SQLite search index needs no explicit cleanup: it reconciles a log that is no longer present on its next observation.

> **Deletion is permanent.** There is no trash and no undo.

## Safety rules

| Rule | Behaviour |
|---|---|
| **A running session is refused** | `session/running`, HTTP 409. An idle but live session is allowed. |
| **The id is validated first** | `^session-[A-Za-z0-9._-]+$`, ≤ 128 characters — a path-traversal value can never address a directory. |
| **Unknown ids are a no-op** | `session/not-found`, HTTP 409. Deleting twice is safe; a retry after a partial failure is harmless. |
| **Neighbours are untouched** | Only the named session's artifacts are removed. Other sessions, their caches, and their pins stay intact. |
| **One write path** | Workspace accounting goes through the runtime's registry when it exposes `forgetSession`; otherwise it is an atomic `workspace.json` rewrite (temp sibling, then rename). |

## Permissions and data access

A plugin runs with your user's privileges, so here is exactly what this one touches:

- **Reads and removes files only under `<DSH_HOME>`** — the paths in the table above. Nothing else on disk is read, written, or sent anywhere.
- **Makes no outbound request.** The only HTTP traffic is the browser posting a session id to the plugin's own route on the DSH origin.
- **Stores no credential and no state.** No API key, no token, no config file, no telemetry.
- **Logs no session content.** Errors name the session id and the failed artifact, never message text.

## Disable or uninstall

- **Disable** — turn it off on the Plugins page, which writes `disabled: true` into the profile's patch layer, or set `disabled: true` on the row in this package's `cordis.patch.yml`.
- **Uninstall** — from the Plugins page, or by hand: remove `dsh-session-delete` from the profile's `dsh.profile.bundles` **and** `dependencies`, run `pnpm install` in the profile, then delete the checkout.

Either way a restart applies it.

## How it works

Two halves are required. The browser cannot touch session files, and the browser→Host Remote surface is owned by Typert's generated endpoints, so an out-of-tree plugin cannot add one. The halves therefore meet over a **same-origin Web route registered by the host half** — the same capability seam the shipped file-upload and session-log-download packages use. Because the Host owns authentication for that origin, the page's session cookie is what authorizes the call; no token is minted or stored.

A successful delete also emits the forwarded `api-session/removed` event. The browser's session list is event-driven rather than re-listed after a mutation, so without it the row would stay on screen until a reload and a second attempt would report `session/not-found`.

| File | Role |
|---|---|
| `lib/index.js` | Host half — the route and all artifact removal |
| `lib/client.js` | Client half — the menu row and the confirmation dialog, in the wrapped `window.__ModuleLoader__.load({ id, factory })` format the page loader expects |
| `cordis.patch.yml` | This bundle's own loader row |
| `package.json` | `dsh.bundle.patch`, the `dsh.client` declaration, and the `./client` export the client-module scan requires |

## HTTP interface

One exact route on the DSH origin, namespaced to this plugin so it cannot collide with a shipped route.

**`GET /dsh-session-delete`** — registration probe. Returns `200 {"ok":true,"route":"/dsh-session-delete","home":"…"}`.

**`POST /dsh-session-delete`**

```jsonc
// request
{ "sessionId": "session-1a2b3c4d-…" }

// success
{ "ok": true, "sessionId": "…", "live": false,
  "directories": ["…"], "cacheRemoved": true, "accounting": "workspace.json rewritten" }

// refusal
{ "ok": false, "code": "session/running" | "session/not-found" | "bad-request" | "method-not-allowed",
  "message": "…" }
```

## Development notes

Four traps cost real debugging time while building this. They are recorded because each one fails silently or misleadingly.

1. **A bundle patch that adds a row must use a root `- insert:`.** A bare `- id:` row is an *override* of an existing row, and the composition runs over an empty array — so it matches nothing and is dropped with `patch insert: entry "..." not found`.
2. **A row's `name` must be a bare package specifier, not a relative path.** A path pointing at the package directory trips Node's `ERR_UNSUPPORTED_DIR_IMPORT`; the entry never mounts and the row sits in the tree forever with `fiberPhase: null`. A specifier also lets the client-module scan find this package's `dsh.client` declaration.
3. **The client half requests only `react`.** A bundle whose factory throws while resolving a module never materializes, and one failed entry makes the boot audit fail the whole page (`1 entry did not activate`). The menu row therefore uses framework-provided hooks and props alone, and the two registrations are isolated so neither can take the other down.
4. **The list is event-driven.** Removing the files without emitting `api-session/removed` leaves the row on screen and turns the next attempt into a confusing `session/not-found`.

A client-half failure is visible in the shell's crash reports under `%APPDATA%/@deepseek-ai/dsh-desktop/logs/crash-*-web-boot.log`, which name the failing entry.

## License

MIT
