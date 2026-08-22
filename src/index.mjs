import { join } from 'node:path'
import { homedir } from 'node:os'
import { createStateStore } from './state.mjs'
import { createCliBridge } from './cli-bridge.mjs'
import { createWatcherService } from './watcher.mjs'
import { makeRoutes } from './routes.mjs'

// Bundled under the "dsh-codebase-memory-watcher" bundle id. The
// companion MCP-client bundle lives in the same package under
// "mcp-codebase-memory" (see cordis.patch.yml). Both bundles share
// this package.json / src/index.mjs.

export const name = 'dsh-codebase-memory'
export const inject = ['webServer']

function resolveStatePath(config) {
  const override = config && typeof config.statePath === 'string' ? config.statePath.trim() : ''
  if (override !== '') return override
  return join(homedir(), '.dsh', 'dsh-codebase-memory', 'watcher.json')
}

function normalizePath(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase()
}

function makeLogger(ctx) {
  const emit = (level, message) => {
    try { ctx && ctx.logger && typeof ctx.logger[level] === 'function' ? ctx.logger[level](message) : null } catch { /* ignore */ }
    if (level === 'error') console.error(message)
    else console.log(message)
  }
  return {
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  }
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return undefined

  const state = createStateStore(resolveStatePath(config))
  const cli = createCliBridge({})
  const defaults = {
    debounceMs: Number.isFinite(config.defaultDebounceMs) ? Number(config.defaultDebounceMs) : 5000,
    mode: typeof config.defaultMode === 'string' ? config.defaultMode : 'moderate',
    ignored: Array.isArray(config.ignored) ? config.ignored : [],
    watchedExtensions: Array.isArray(config.watchedExtensions) ? config.watchedExtensions : [],
    usePolling: config.usePolling === true,
  }
  const log = makeLogger(ctx)
  const svc = createWatcherService({ state, cli, defaults, log })

  const disposers = []

  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    const svcFacade = { svc, state, cli }
    try {
      for (const route of makeRoutes(svcFacade)) {
        disposers.push(ctx.webServer.register(route))
      }
      log.info('[dsh-codebase-memory] watcher routes registered under /api/dsh-codebase-memory/watcher/*')
    } catch (err) {
      log.error('[dsh-codebase-memory] failed to register webServer routes: ' + (err && err.message ? err.message : String(err)))
    }
  } else {
    log.warn('[dsh-codebase-memory] ctx.webServer not available; watcher routes disabled')
  }

  // On plugin enable: rebuild watchers from persisted state and optionally
  // auto-attach to every currently indexed project.
  void (async () => {
    try {
      const existing = await state.all()
      const knownPaths = new Set(existing.map((w) => normalizePath(w.repoPath)))
      for (const record of existing) {
        if (record.status === 'stopped') continue
        try {
          await svc.start({
            repoPath: record.repoPath,
            debounceMs: record.debounceMs,
            mode: record.mode,
            ignored: record.ignored,
            watchedExtensions: record.watchedExtensions,
            usePolling: record.usePolling,
          })
        } catch (err) {
          log.error('[dsh-codebase-memory] failed to restart watcher ' + record.id + ': ' + (err && err.message ? err.message : String(err)))
        }
      }
      if (config.autoAttach !== false) {
        try {
          const projects = await cli.listProjects()
          for (const project of projects) {
            const rootPath = project.root_path || project.rootPath
            if (!rootPath) continue
            if (knownPaths.has(normalizePath(rootPath))) continue
            try {
              await svc.start({ repoPath: rootPath })
              knownPaths.add(normalizePath(rootPath))
            } catch (err) {
              log.error('[dsh-codebase-memory] auto-attach ' + rootPath + ' failed: ' + (err && err.message ? err.message : String(err)))
            }
          }
          log.info('[dsh-codebase-memory] auto-attach complete; CLI executable=' + cli.executable)
        } catch (err) {
          log.warn('[dsh-codebase-memory] auto-attach skipped: ' + (err && err.message ? err.message : String(err)))
        }
      }
    } catch (err) {
      log.error('[dsh-codebase-memory] startup failed: ' + (err && err.message ? err.message : String(err)))
    }
  })()

  const dispose = async () => {
    for (const disposeOne of disposers) {
      try { disposeOne && disposeOne() } catch { /* ignore */ }
    }
    await svc.disposeAll()
  }

  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  else return dispose
}

export { createCliBridge, createStateStore, createWatcherService, makeRoutes }
