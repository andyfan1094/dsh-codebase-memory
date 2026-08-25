# DSH Codebase Memory

[中文文档](README.zh.md) | English

Local DSH bundle that connects [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp) through the official `@deepseek-ai/dsh-mcp-client` bridge, and ships a file-system watcher that keeps the knowledge graph fresh.

## Runtime

- `codebase-memory-mcp@0.10.8`
- Windows AMD64 release SHA-256: `b43ad982994c4d829670749e08d3b622a74bb20041fc0a7d02bef6113f81c34d`
- MCP namespace: `mcp__codebase_memory__*`
- Graph UI: http://127.0.0.1:9749

## Bundles

The package registers two Cordis bundles in `cordis.patch.yml`:

| Bundle id | Purpose |
|---|---|
| `mcp-codebase-memory` | Bridges the upstream MCP server into DSH so all `mcp__codebase_memory__*` tools (search_graph, detect_changes, get_architecture, index_repository, …) are exposed natively. |
| `dsh-codebase-memory-watcher` | Same package, second bundle id; spins up a chokidar watcher per project, debounces file edits, and re-runs `index_repository` via the global `codebase-memory-mcp` CLI. |

The watcher never owns the MCP client connection — it shells out to `codebase-memory-mcp cli index_repository '{"repo_path":"..."}'` for each rebuild, which is acceptable because the upstream indexer is fast enough on small projects (< 30 s for `dsh-github`).

## Watcher routes (auto-registered when `webServer` is available)

| Method + path | Body / query | Effect |
|---|---|---|
| `GET /api/dsh-codebase-memory/watcher/list` | – | List every persisted watcher with `status`, `lastRun`, `lastDurationMs`, `lastError`, … |
| `GET /api/dsh-codebase-memory/watcher/status?id=<id>` | – | Same payload for a single watcher. |
| `POST /api/dsh-codebase-memory/watcher/start` | `{ repoPath, debounceMs?, mode?, ignored?, watchedExtensions? }` | Start a watcher (persists state, returns the new `id`). |
| `POST /api/dsh-codebase-memory/watcher/stop` | `{ id }` or `?id=` | Stop + mark stopped (state kept). |
| `POST /api/dsh-codebase-memory/watcher/rebuild` | `{ id }` | Trigger an immediate rebuild regardless of pending edits. |
| `POST /api/dsh-codebase-memory/watcher/restart` | – | Restart every non-stopped watcher from persisted state. |
| `POST /api/dsh-codebase-memory/watcher/auto-attach` | – | Call `list_projects` on the MCP server and start a watcher for each project not already covered. |
| `GET /api/dsh-codebase-memory/watcher/cli-info` | – | Report the resolved `codebase-memory-mcp.exe` path. |

### Defaults (configurable in `cordis.patch.yml`)

- `debounceMs`: `5000` (5 s quiet period before rebuild)
- `mode`: `moderate` (type-aware LSP call/usage resolution; `fast` skips similarity, `full` enables similarity + every file)
- `autoAttach`: `true` (start a watcher for every project the MCP server already knows at boot)
- `usePolling`: `false` (native file notifications by default; enable polling only for filesystems that miss events because it increases CPU and disk activity)
- `ignored`: `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/.turbo/**`, `**/.codebase-memory/**`, `**/.pnpm-store/**`, `**/target/**`, `**/__pycache__/**`, `**/.venv/**`
- `watchedExtensions`: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php`, `.vue`, `.svelte`

### State persistence

Watcher records live in `~/.dsh/dsh-codebase-memory/watcher.json` and are written with owner-only permissions where the platform supports them. Plugin disposal closes live handles without changing the persisted intent; the next DSH Web start re-creates every watcher that the user did not explicitly stop.

## Screenshots

![dsh-codebase-memory screenshot](docs/screenshots/codebase-memory-cli.png)


## Install

Download the newest `dsh-codebase-memory-*.tgz` from [Releases](https://github.com/andyfan1094/dsh-codebase-memory/releases) and add it to the profile:

```powershell
dsh plugin --profile web add D:\downloads\dsh-codebase-memory-0.2.0.tgz
```

For local development, install from a checkout instead:

```powershell
dsh plugin --profile web add link:D:/项目/dsh-codebase-memory
```

Restart the DSH Web host after installation.

## Remove

```powershell
dsh plugin --profile web remove dsh-codebase-memory
```

The global runtime remains pinned independently and can be removed with `npm uninstall -g codebase-memory-mcp`.
