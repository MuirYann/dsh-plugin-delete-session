/**
 * dsh-session-delete — host half.
 *
 * Removes one session's durable footprint: its log directory, its projection
 * cache record, and its accounting in the workspace registry.
 *
 * Why this is a host half at all: only the Host process can touch these files,
 * and the browser has no Remote endpoint that deletes a session. The plugin
 * therefore owns a Web route and the client half calls it over same-origin
 * `fetch` — the same capability seam feature packages use for file upload and
 * session-log download. The route path is namespaced to this plugin so it can
 * never collide with a shipped route.
 */
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Exact-path route the client half posts to. */
const ROUTE = '/dsh-session-delete'

/** The profile patch row mounts this plugin; the host side needs the web server. */
export const inject = ['webServer']

/** A session id is a directory name here, so the accepted spelling is narrow. */
const SESSION_ID = /^session-[A-Za-z0-9._-]+$/

/**
 * Resolve the Harness home the running Host actually used.
 * @returns the absolute Harness home path.
 */
function harnessHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/** One JSON response with the status the client half matches on. */
function reply(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** Read and parse a small JSON request body. */
async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 8192) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

/**
 * Find every project directory holding this session.
 *
 * The structure is `<home>/sessions/<encoded-cwd>/<session-id>/`, and the
 * encoded directory is a lossy slug, so this scans rather than recomputing the
 * encoding: the session id itself is the directory name being matched.
 * @param home - Harness home.
 * @param sessionId - the session to locate.
 * @returns absolute session directories that exist.
 */
async function sessionDirs(home, sessionId) {
  const root = join(home, 'sessions')
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const found = []
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, sessionId)
    if (existsSync(candidate)) found.push(candidate)
  }
  return found
}

/**
 * Drop the session from the workspace registry.
 *
 * Preferred path is the registry service, which serializes against its own
 * writes. A newer registry also exposes `forgetSession`, which clears the pin
 * and archive sets in the same write; against an older runtime this falls back
 * to a direct `workspace.json` edit.
 * @param ctx - host context.
 * @param sessionId - the session to forget.
 * @returns how the accounting was cleared.
 */
async function forgetSession(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined && typeof registry.forgetSession === 'function') {
    await registry.forgetSession(sessionId)
    return 'registry.forgetSession'
  }
  if (registry !== undefined && typeof registry.unpinSession === 'function') {
    // Unpin is idempotent, and its failure must not block the file removal.
    await registry.unpinSession(sessionId).catch(() => {})
  }

  const path = join(harnessHome(), 'storages', 'workspace.json')
  let document
  try {
    document = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return 'no workspace document'
    throw error
  }
  let changed = false
  const drop = (list) => {
    if (!Array.isArray(list)) return list
    const next = list.filter(id => id !== sessionId)
    if (next.length !== list.length) changed = true
    return next
  }
  const global = document.global
  if (global !== undefined && typeof global === 'object') {
    global.archivedSessionIds = drop(global.archivedSessionIds)
    global.pinnedSessionIds = drop(global.pinnedSessionIds)
  }
  const workspaces = document.tables?.workspaces
  if (workspaces !== undefined && typeof workspaces === 'object') {
    for (const record of Object.values(workspaces)) {
      if (record === null || typeof record !== 'object') continue
      record.sessionIds = drop(record.sessionIds)
    }
  }
  if (!changed) return 'workspace document already clean'
  // Same skeleton the storage backend writes: temp sibling, then rename.
  const temporary = `${path}.dsh-session-delete.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`)
  await rename(temporary, path)
  return 'workspace.json rewritten'
}

/**
 * Remove one session's durable artifacts.
 * @param ctx - host context.
 * @param sessionId - the session to remove.
 * @returns a report naming every artifact class and its outcome.
 */
async function deleteSession(ctx, sessionId) {
  const home = harnessHome()
  const live = ctx.get('sessions')?.get(sessionId)
  const agent = ctx.get('agents')?.get(sessionId)
  if (agent?.status === 'running') {
    return { ok: false, code: 'session/running', message: 'this session is running; stop it before deleting' }
  }

  const dirs = await sessionDirs(home, sessionId)
  const cache = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  if (dirs.length === 0 && !existsSync(cache)) {
    return { ok: false, code: 'session/not-found', message: 'no stored session with that id' }
  }

  const removed = []
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true })
    removed.push(dir)
  }
  let cacheRemoved = false
  if (existsSync(cache)) {
    await rm(cache, { force: true })
    cacheRemoved = true
  }
  const accounting = await forgetSession(ctx, sessionId)

  // The browser's session list is driven by the forwarded `api-session/removed`
  // event, not by re-listing after a mutation: without this the row survives on
  // screen until the page reloads, and a second delete attempt reports
  // `session/not-found`. `api-remotes` forwards exactly this event name.
  try {
    ctx.emit('api-session/removed', sessionId)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-session-delete: could not announce the removal of "${sessionId}": ${String(error)}`)
  }

  // A live session now has no log behind it; say so rather than pretending the
  // removal was clean.
  return {
    ok: true,
    sessionId,
    live: live !== undefined,
    directories: removed,
    cacheRemoved,
    accounting,
  }
}

/**
 * Register the delete route for exactly the plugin's lifetime.
 * @param ctx - host context carrying the web server.
 */
export function apply(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      // GET is the registration probe: it proves this route is mounted without
      // touching any session.
      if (req.method === 'GET') {
        reply(res, 200, { ok: true, route: ROUTE, home: harnessHome() })
        return
      }
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, code: 'method-not-allowed', message: 'POST only' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const sessionId = body?.sessionId
        if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || sessionId.length > 128) {
          reply(res, 400, { ok: false, code: 'bad-request', message: 'a session id is required' })
          return
        }
        const result = await deleteSession(ctx, sessionId)
        reply(res, result.ok ? 200 : 409, result)
      } catch (error) {
        ctx.logger?.warn?.(`dsh-session-delete: ${String(error)}`)
        reply(res, 500, { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) })
      }
    },
  })
  ctx.effect(() => dispose, 'dsh-session-delete: route')
}
