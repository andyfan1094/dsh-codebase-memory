import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// State store: persisted to ~/.dsh/dsh-codebase-memory/watcher.json so a
// DSH web restart can rebuild watchers automatically.

const STATE_VERSION = 1

export function createStateStore(filePath) {
  let state = {
    version: STATE_VERSION,
    watches: {},
    nextId: 1,
  }
  let loaded = false
  let persistTail = Promise.resolve()

  async function load() {
    if (loaded) return
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === STATE_VERSION && typeof parsed.watches === 'object') {
        state = parsed
      }
    } catch (err) {
      // Missing or corrupt: start clean; the watcher will rebuild on demand.
      if (err && err.code !== 'ENOENT') {
        console.warn('[dsh-codebase-memory] state load failed:', err.message)
      }
    }
    loaded = true
  }

  async function persist() {
    const snapshot = JSON.stringify(state, null, 2)
    const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + randomUUID()
    persistTail = persistTail
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 })
        try { await chmod(tmp, 0o600) } catch { /* Windows ACLs are inherited */ }
        await rename(tmp, filePath)
      })
      .catch((err) => console.warn('[dsh-codebase-memory] state persist failed:', err.message))
    return persistTail
  }

  return {
    async all() {
      await load()
      return Object.values(state.watches)
    },
    async get(id) {
      await load()
      return state.watches[id] || null
    },
    async upsert(record) {
      await load()
      if (!record.id) record.id = 'w' + String(state.nextId++)
      state.watches[record.id] = { ...record }
      await persist()
      return record.id
    },
    async update(id, patch) {
      await load()
      const existing = state.watches[id]
      if (!existing) return null
      state.watches[id] = { ...existing, ...patch, id }
      await persist()
      return state.watches[id]
    },
    async remove(id) {
      await load()
      if (!state.watches[id]) return false
      delete state.watches[id]
      await persist()
      return true
    },
  }
}
