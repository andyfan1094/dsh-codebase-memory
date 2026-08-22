import chokidar from 'chokidar'
import { createCliBridge } from './cli-bridge.mjs'

// Per-project watcher: chokidar watches the repo root, debounces events,
// and rebuilds the knowledge graph by calling the global
// codebase-memory-mcp CLI. The MCP-client bundle does not expose its
// client handle to other bundles, so each rebuild spawns its own
// short-lived .exe — startup is a few seconds which is acceptable.

function normalizeExtensions(list) {
  const out = new Set()
  for (const ext of list || []) {
    if (typeof ext !== 'string') continue
    const clean = ext.startsWith('.') ? ext : '.' + ext
    out.add(clean.toLowerCase())
  }
  return out
}

// Normalize a path to forward slashes + lowercase for stable cross-platform
// ignore matching. Chokidar delivers absolute paths whose separator
// varies by platform, so we collapse to a single representation.
function normalizePath(filePath) {
  if (!filePath) return ''
  return String(filePath).replace(/\\/g, '/').toLowerCase()
}

// Compatibility shim for the optional logger argument: it can be a single
// `(level, message)` function or an object with `info/error/warn` methods.
function callLog(log, level, message) {
  if (!log) return
  if (typeof log === 'function') {
    try { log(level, message) } catch { /* ignore */ }
    return
  }
  if (typeof log[level] === 'function') {
    try { log[level](message) } catch { /* ignore */ }
    return
  }
  if (level === 'error') console.error(message)
  else console.log(message)
}

// Build a single function that chokidar's `ignored` can call. Accepts the
// configured glob-ish patterns ("**/node_modules/**", "**/.git/**", …) and
// matches them anywhere in the normalized absolute path.
function buildIgnoreMatcher(patterns) {
  const list = (Array.isArray(patterns) ? patterns : []).filter((p) => typeof p === 'string' && p.length > 0)
  return (filePath) => {
    if (!filePath) return false
    const normalized = normalizePath(filePath)
    for (const pattern of list) {
      const token = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/^\*\//, '').replace(/\/\*$/, '').toLowerCase()
      if (token === '') continue
      if (normalized.includes('/' + token + '/') || normalized.endsWith('/' + token) || normalized.startsWith(token + '/')) return true
    }
    return false
  }
}

export function createWatcherService({ state, cli, defaults, log }) {
  // watchId -> { chokidar, record, debounceTimer, pendingFiles, running, rebuildPromise }
  const handles = new Map()

  async function rebuild(record, { reason = 'manual' } = {}) {
    const id = record.id
    if (!id) return { ok: false, error: 'missing watch id' }
    const handle = handles.get(id)
    if (handle?.running) {
      handle.queuedReason = reason
      callLog(log, 'info', `[dsh-codebase-memory] rebuild queued for ${id} (${reason})`)
      return { ok: true, queued: true }
    }

    const run = (async () => {
      const startedAt = Date.now()
      try {
        callLog(log, 'info', `[dsh-codebase-memory] rebuilding ${record.repoPath} (${record.mode}, reason=${reason})`)
        const result = await cli.indexRepository(record.repoPath, record.mode)
        const finishedAt = Date.now()
        const durationMs = finishedAt - startedAt
        await state.update(id, {
          status: 'idle',
          lastRun: finishedAt,
          lastDurationMs: durationMs,
          lastError: '',
          lastResult: summarizeIndexResult(result),
        })
        callLog(log, 'info', `[dsh-codebase-memory] rebuild ${id} done in ${durationMs}ms`)
        return { ok: true, durationMs, result }
      } catch (err) {
        const finishedAt = Date.now()
        const message = err && err.message ? err.message : String(err)
        await state.update(id, { status: 'unhealthy', lastRun: finishedAt, lastError: message })
        callLog(log, 'error', `[dsh-codebase-memory] rebuild ${id} failed: ${message}`)
        return { ok: false, error: message }
      }
    })()

    if (handle) {
      handle.running = true
      handle.rebuildPromise = run
    }
    const result = await run
    if (handle) {
      handle.running = false
      handle.rebuildPromise = null
      const queuedReason = handle.queuedReason
      handle.queuedReason = null
      if (queuedReason && !handle.stopping) {
        const fresh = (await state.get(id)) || record
        handle.rebuildPromise = rebuild(fresh, { reason: queuedReason })
      }
    }
    return result
  }

  function summarizeIndexResult(result) {
    if (!result || typeof result !== 'object') return null
    return {
      status: typeof result.status === 'string' ? result.status : null,
      nodes: typeof result.nodes === 'number' ? result.nodes : null,
      edges: typeof result.edges === 'number' ? result.edges : null,
      project: typeof result.project === 'string' ? result.project : null,
    }
  }

  function shouldHandlePath(filePath, exts) {
    if (!filePath) return false
    const lower = filePath.toLowerCase()
    for (const ext of exts) {
      if (lower.endsWith(ext)) return true
    }
    return false
  }

  // Find an existing watch record for this repoPath so we don't accumulate
  // duplicates when DSH restarts and re-applies startup state.
  async function findExistingId(repoPath) {
    const target = normalizePath(repoPath)
    const all = await state.all()
    for (const record of all) {
      if (normalizePath(record.repoPath) === target) return record.id
    }
    return null
  }

  async function start({ repoPath, debounceMs, mode, ignored, watchedExtensions, usePolling, autoRebuild = true }) {
    const normalizedPath = normalizePath(repoPath)
    if (normalizedPath === '') throw new Error('repoPath required')

    const existingId = await findExistingId(repoPath)
    const fields = {
      repoPath,
      debounceMs: Number.isFinite(debounceMs) ? debounceMs : defaults.debounceMs,
      mode: mode || defaults.mode,
      ignored: Array.isArray(ignored) && ignored.length > 0 ? ignored : defaults.ignored,
      watchedExtensions: Array.isArray(watchedExtensions) && watchedExtensions.length > 0 ? watchedExtensions : defaults.watchedExtensions,
      usePolling: usePolling === undefined ? defaults.usePolling === true : usePolling === true,
      status: 'starting',
      lastRun: 0,
      lastError: '',
      createdAt: Date.now(),
    }
    let id
    if (existingId) {
      const merged = await state.update(existingId, fields)
      id = merged && merged.id ? merged.id : existingId
    } else {
      id = await state.upsert(fields)
    }
    const record = await state.get(id)

    // If we already have a live handle for this id, drop it first.
    if (handles.has(id)) await stop(id, { skipState: true })

    const exts = normalizeExtensions(record.watchedExtensions)
    const matcher = buildIgnoreMatcher(record.ignored)

    const watcher = chokidar.watch(repoPath, {
      ignored: (p) => {
        if (!p || p === repoPath) return false
        // User-configured ignore patterns (node_modules, .git, …) always win.
        if (matcher(p)) return true
        // Look for an extension; chokidar passes both directories and files.
        const dot = p.lastIndexOf('.')
        if (dot < 0 || dot === p.length - 1) {
          // No extension at all (typical for a directory path): let chokidar
          // recurse so it can find our watched files inside.
          return false
        }
        const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
        if (dot < slash) {
          // The last '.' is in a directory component, not a filename
          // extension (e.g. "foo.bar/baz"). Treat as a directory.
          return false
        }
        // Real filename with extension: keep only the ones we care about.
        const ext = p.slice(dot).toLowerCase()
        return !exts.has(ext)
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      // Native notifications are the safe default. Polling can be enabled per
      // watcher for filesystems that do not deliver reliable change events.
      usePolling: record.usePolling === true,
      interval: 500,
      binaryInterval: 1000,
    })

    const handle = {
      chokidar: watcher,
      record,
      debounceTimer: null,
      pendingFiles: new Set(),
      running: false,
      rebuildPromise: null,
      queuedReason: null,
      stopping: false,
    }
    handles.set(id, handle)

    const scheduleRebuild = () => {
      if (handle.debounceTimer) clearTimeout(handle.debounceTimer)
      handle.debounceTimer = setTimeout(async () => {
        handle.debounceTimer = null
        const files = [...handle.pendingFiles]
        handle.pendingFiles.clear()
        const fresh = (await state.get(id)) || { ...handle.record, id }
        handle.rebuildPromise = rebuild(fresh, { reason: files.length + ' files changed' })
        try { await handle.rebuildPromise } catch { /* rebuild swallows */ }
      }, record.debounceMs)
    }

    watcher.on('add', (p) => { if (shouldHandlePath(p, exts)) { handle.pendingFiles.add(p); if (autoRebuild) scheduleRebuild() } })
    watcher.on('change', (p) => { if (shouldHandlePath(p, exts)) { handle.pendingFiles.add(p); if (autoRebuild) scheduleRebuild() } })
    watcher.on('unlink', (p) => { if (shouldHandlePath(p, exts)) { handle.pendingFiles.add(p); if (autoRebuild) scheduleRebuild() } })
    watcher.on('error', (err) => {
      const message = err && err.message ? err.message : String(err)
      callLog(log, 'error', `[dsh-codebase-memory] watcher ${id} error: ${message}`)
      void state.update(id, { status: 'unhealthy', lastError: message })
    })
    watcher.on('ready', async () => {
      await state.update(id, { status: 'idle', lastError: '' })
      callLog(log, 'info', `[dsh-codebase-memory] watching ${repoPath} (debounce=${record.debounceMs}ms, mode=${record.mode})`)
    })

    return record
  }

  async function stop(id, { skipState = false } = {}) {
    const handle = handles.get(id)
    if (!handle) return false
    handle.stopping = true
    handle.queuedReason = null
    if (handle.debounceTimer) clearTimeout(handle.debounceTimer)
    handle.pendingFiles.clear()
    if (handle.rebuildPromise) { try { await handle.rebuildPromise } catch { /* ignore */ } }
    try { await handle.chokidar.close() } catch { /* ignore */ }
    handles.delete(id)
    if (!skipState) await state.update(id, { status: 'stopped' })
    return true
  }

  async function restart() {
    const records = await state.all()
    for (const record of records) {
      if (record.status === 'stopped') continue
      await start({
        repoPath: record.repoPath,
        debounceMs: record.debounceMs,
        mode: record.mode,
        ignored: record.ignored,
        watchedExtensions: record.watchedExtensions,
        usePolling: record.usePolling,
      })
    }
  }

  async function rebuildOne(id) {
    const record = await state.get(id)
    if (!record) return { ok: false, error: 'unknown watch id: ' + id }
    return await rebuild(record, { reason: 'manual rebuild' })
  }

  async function disposeAll() {
    for (const id of [...handles.keys()]) await stop(id, { skipState: true })
  }

  return { start, stop, restart, rebuildOne, rebuild, disposeAll, handles }
}

export { createCliBridge }
