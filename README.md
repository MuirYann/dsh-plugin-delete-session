# dsh-session-delete

A **DSH** (DeepSeek Harness) plugin that adds a **Delete session** row to a
session's `...` menu and actually removes the session's durable footprint —
its log, its projection cache record, and its workspace accounting.

The shipped Web GUI can archive a session but never delete one: `archiveSession`
is the only session-level mutation the Host exposes, and the workspace registry's
`delete` removes a *workspace registration* while explicitly retaining every
session log. This plugin adds the missing action without patching DSH itself.

```
Session menu:   置顶会话 · 重命名 · 分叉会话 · 归档会话 · 删除会话
                                                          ↑ this plugin
```

## Requirements

- DSH with the desktop or web profile (any composition that mounts
  `@deepseek-ai/dsh-host-webserver` and the session-menu slot).
- The plugin is two halves and needs both: the browser half renders the menu row
  and the confirmation, the host half removes the files.

## Install

The plugin installs as a **profile bundle**. That is deliberate: a row written
directly into the profile's `cordis.patch.yml` becomes a *ledger item*, which the
Plugins page renders inside the **Official** group beside the built-in plugins
and which cannot be enabled, configured, or uninstalled on its own. A bundle
appears under **Installed** with its own card, switch, and detail page.

1. Put this directory where the profile can reach it — either copied into the
   profile's own plugin area, or left anywhere on disk and linked:

   ```text
   <DSH_HOME>/profiles/<profile>/plugins/dsh-session-delete/     (copy)
   ```

2. Register it in that profile's `package.json` — both as a dependency and in the
   bundle list. The dependency value is a pnpm link target, so it points at
   wherever step 1 put the directory:

   ```json
   {
     "dependencies": {
       "dsh-session-delete": "link:./plugins/dsh-session-delete"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-session-delete"]
       }
     }
   }
   ```

   An absolute target works too (`"link:D:/src/dsh-plugin-delete-session"`), which
   keeps one working copy — useful while developing the plugin.

3. Install it into the profile:

   ```sh
   pnpm install --dir <DSH_HOME>/profiles/<profile>
   ```

4. Restart DSH. Profiles compose at startup, so the row mounts on the next launch.

`<DSH_HOME>` defaults to `~/.dsh` (Windows: `%USERPROFILE%\.dsh`).

## Usage

Open a session's `...` menu and choose **删除会话**. A confirmation naming the
session appears; confirming removes it and the row leaves the sidebar without a
page reload.

## What a delete removes

| Artifact | Path |
| --- | --- |
| Session directory (lock file and every log generation, historical versions included) | `<DSH_HOME>/sessions/<encoded-cwd>/<session-id>/` |
| Projection cache record | `<DSH_HOME>/storages/session_projcache/sessions/<id>.json` |
| Workspace accounting | the id is dropped from every `tables.workspaces[*].sessionIds`, plus the global `archivedSessionIds` and `pinnedSessionIds` in `<DSH_HOME>/storages/workspace.json` |

The session directory is located by scanning for the id as a directory name
rather than recomputing the lossy workspace-path encoding, so it is found
regardless of which project directory holds it.

The SQLite search index needs no explicit cleanup: it reconciles a log that is no
longer present on its next observation.

## Safety rules

- **A running session is refused** (`session/running`, HTTP 409) rather than
  racing its log writer. An idle but live session is allowed.
- **The session id is validated** (`^session-[A-Za-z0-9._-]+$`, ≤128 characters)
  before it can address a directory, so a path-traversal value is rejected.
- **Unknown ids are a no-op** (`session/not-found`, HTTP 409); deleting twice is
  safe and a retry after a partial failure is harmless.
- **Only the plugin's own route is touched.** Nothing else in the profile is
  rewritten, and the workspace accounting falls back to an atomic
  `workspace.json` rewrite (temp sibling, then rename) when the runtime's
  registry exposes no `forgetSession`.
- **Deletion is permanent.** There is no trash and no undo.

## How the two halves meet

The browser cannot touch session files, and the browser→Host Remote surface is
owned by Typert's generated endpoints, so an out-of-tree plugin cannot add one.
The halves therefore meet over a **same-origin Web route registered by the host
half** (`POST /dsh-session-delete`) — the same capability seam the shipped
file-upload and session-log-download packages use. The Host owns authentication
for that origin, so the page's session cookie authorizes the call. `GET` on the
same path answers a registration probe.

A successful delete also emits the forwarded `api-session/removed` event. The
browser's session list is event-driven rather than re-listed after a mutation, so
without it the row would stay on screen until a reload and a second attempt would
report `session/not-found`.

| File | Role |
| --- | --- |
| `lib/index.js` | Host half: the route and all artifact removal |
| `lib/client.js` | Client half: the menu row and the confirmation dialog, in the wrapped `window.__ModuleLoader__.load({ id, factory })` format the page loader expects |
| `cordis.patch.yml` | This bundle's own loader row |
| `package.json` | `dsh.bundle.patch` plus the `dsh.client` declaration and `./client` export the client-module scan requires |

## Disable or uninstall

- **Disable**: turn the plugin off on the Plugins page (writes `disabled: true`)
  or set `disabled: true` on its row in this package's `cordis.patch.yml`.
- **Uninstall**: remove `dsh-session-delete` from the profile's
  `dsh.profile.bundles` and `dependencies`, run `pnpm install` in the profile,
  then delete this directory.

Either way a restart applies the change.

## Development notes

Three traps cost real debugging time while building this; they are recorded here
because they are easy to repeat:

1. **A bundle patch that adds a row must use a root `- insert:`.** A bare
   `- id:` row is an *override* of an existing row, and the composition runs over
   an empty array — so it matches nothing and is silently dropped
   (`patch insert: entry "..." not found`).
2. **A row's `name` must be a bare package specifier, not a relative path.** A
   path pointing at the package directory trips Node's
   `ERR_UNSUPPORTED_DIR_IMPORT`; the entry never mounts and the row sits in the
   tree forever with `fiberPhase: null`. A specifier also lets the client-module
   scan find this package's `dsh.client` declaration.
3. **The client half requests only `react`.** A bundle whose factory throws while
   resolving a module fails to materialize, and a failed entry makes the boot
   audit report the whole page as failed (`1 entry did not activate`). The menu
   row therefore uses the framework-provided hooks and props alone, and the two
   registrations are isolated so neither can take the other down.

Restarting is also visible in the shell's crash logs under
`%APPDATA%/@deepseek-ai/dsh-desktop/logs/crash-*-web-boot.log`, which name the
failing entry — the fastest way to see a client-half failure.

## License

MIT
