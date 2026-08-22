import { existsSync } from 'node:fs'

// DSH webServer.register() expects an array of WebRoute objects with shape
// `{ kind: 'exact', path, handler }`. We mirror dsh-github's pattern: parse
// the JSON body manually, gate on loopback remote address (the watcher is
// an admin surface, never exposed publicly), and write the result with
// `res.writeHead` + `res.end`.

const MAX_BODY = 256 * 1024

function normalizeRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.trim() === '') return null
  return repoPath.trim().replace(/\\/g, '/')
}

function isLoopbackRequest(req) {
  const address = (req && req.socket && req.socket.remoteAddress) || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  if (!res || typeof res.writeHead !== 'function') return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  if (!req) return null
  if (req.body && typeof req.body === 'object') return req.body
  let size = 0
  const parts = []
  return await new Promise((resolve) => {
    req.on('data', (chunk) => {
      size += chunk.byteLength
      if (size > MAX_BODY) { resolve(null); req.destroy(); return }
      parts.push(chunk)
    })
    req.on('end', () => {
      if (parts.length === 0) return resolve(null)
      try {
        const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : null)
      } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function param(req, key) {
  if (!req || typeof req.url !== 'string') return undefined
  return new URL(req.url, 'http://localhost').searchParams.get(key) || undefined
}

function guardLoopback(req, res) {
  if (!isLoopbackRequest(req)) { writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }); return false }
  return true
}

export function makeRoutes(svc) {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/list',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const items = await svc.state.all()
        writeJson(res, 200, { ok: true, watches: items })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/status',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const id = param(req, 'id')
        if (!id) { writeJson(res, 400, { ok: false, error: 'missing id' }); return }
        const record = await svc.state.get(id)
        if (!record) { writeJson(res, 404, { ok: false, error: 'unknown id' }); return }
        writeJson(res, 200, { ok: true, watch: record })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/start',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const body = await readJsonBody(req)
        const repoPath = normalizeRepoPath(body && body.repoPath)
        if (!repoPath) { writeJson(res, 400, { ok: false, error: 'missing repoPath' }); return }
        if (!existsSync(repoPath)) { writeJson(res, 400, { ok: false, error: 'repoPath does not exist' }); return }
        const watch = await svc.svc.start({
          repoPath,
          debounceMs: body && body.debounceMs,
          mode: body && body.mode,
          ignored: body && body.ignored,
          watchedExtensions: body && body.watchedExtensions,
          usePolling: body && body.usePolling,
        })
        writeJson(res, 200, { ok: true, watch })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/stop',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const body = await readJsonBody(req)
        const id = (body && body.id) || param(req, 'id')
        if (!id) { writeJson(res, 400, { ok: false, error: 'missing id' }); return }
        const stopped = await svc.svc.stop(id)
        writeJson(res, stopped ? 200 : 404, { ok: stopped, id })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/rebuild',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const body = await readJsonBody(req)
        const id = (body && body.id) || param(req, 'id')
        if (!id) { writeJson(res, 400, { ok: false, error: 'missing id' }); return }
        const result = await svc.svc.rebuildOne(id)
        writeJson(res, result.ok ? 200 : 500, result)
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/restart',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        await svc.svc.restart()
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/auto-attach',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        const projects = await svc.cli.listProjects()
        const existing = new Map((await svc.state.all()).map((w) => [normalizeRepoPath(w.repoPath), w.id]))
        const attached = []
        const skipped = []
        for (const project of projects) {
          const rootPath = project.root_path || project.rootPath
          if (!rootPath) continue
          const normalized = normalizeRepoPath(rootPath)
          if (!normalized || existing.has(normalized)) { skipped.push({ rootPath, reason: 'already watched' }); continue }
          try {
            const watch = await svc.svc.start({ repoPath: normalized })
            attached.push(watch)
          } catch (err) {
            skipped.push({ rootPath, reason: (err && err.message) || String(err) })
          }
        }
        writeJson(res, 200, { ok: true, attached: attached.length, watches: attached, skipped })
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-codebase-memory/watcher/cli-info',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed: ' + req.method }); return }
        writeJson(res, 200, { ok: true, executable: svc.cli.executable })
      },
    },
  ]
}
