import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStateStore } from '../src/state.mjs'
import { createWatcherService } from '../src/watcher.mjs'

const waitFor = async (predicate, timeoutMs = 3000) => {
  const started = Date.now()
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function fixture(indexRepository = async () => ({ status: 'indexed', nodes: 1, edges: 1 })) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cbm-watcher-'))
  await writeFile(join(dir, 'entry.js'), 'export const value = 1\n')
  const state = createStateStore(join(dir, 'watcher.json'))
  const cli = { indexRepository }
  const service = createWatcherService({
    state,
    cli,
    defaults: { debounceMs: 20, mode: 'fast', ignored: [], watchedExtensions: ['.js'], usePolling: false },
    log: null,
  })
  return { dir, state, service }
}

test('disposeAll preserves persisted watcher intent for Host restart recovery', async () => {
  const { dir, state, service } = await fixture()
  const record = await service.start({ repoPath: dir, autoRebuild: false })
  await waitFor(async () => (await state.get(record.id))?.status === 'idle')
  await service.disposeAll()
  assert.notEqual((await state.get(record.id)).status, 'stopped')
})

test('a rebuild requested while another rebuild runs is queued and executed', async () => {
  let releaseFirst
  let calls = 0
  const first = new Promise((resolve) => { releaseFirst = resolve })
  const { dir, state, service } = await fixture(async () => {
    calls += 1
    if (calls === 1) await first
    return { status: 'indexed', nodes: calls, edges: calls }
  })
  const record = await service.start({ repoPath: dir, autoRebuild: false })
  await waitFor(async () => (await state.get(record.id))?.status === 'idle')
  const running = service.rebuildOne(record.id)
  await waitFor(() => calls === 1)
  const queued = await service.rebuildOne(record.id)
  assert.deepEqual(queued, { ok: true, queued: true })
  releaseFirst()
  await running
  await waitFor(() => calls === 2)
  await service.disposeAll()
})