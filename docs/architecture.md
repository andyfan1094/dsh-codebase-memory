# Architecture

One package registers two Cordis bundles through `cordis.patch.yml`:

| Bundle id | Role |
|---|---|
| `mcp-codebase-memory` | Bridges the upstream Codebase Memory MCP server into DSH through the official `@deepseek-ai/dsh-mcp-client`, so every `mcp__codebase_memory__*` tool is registered natively in the session tool list. |
| `dsh-codebase-memory-watcher` | Same package, second bundle id. Runs one chokidar watcher per registered project and rebuilds indexes after edits settle. |

## Data flow

- Agent sessions call `mcp__codebase_memory__*` tools; calls go through the DSH MCP client bridge to the local `codebase-memory-mcp` server.
- The Graph UI at `http://127.0.0.1:9749` is served by the upstream server itself and stays independent of DSH.

## Watcher design

- Each watcher debounces file events (`debounceMs`, default 5000) and then invokes the global CLI (`codebase-memory-mcp cli index_repository`) with the repository path.
- The watcher deliberately does not share or own the MCP client connection; rebuilding through a short-lived CLI process keeps bridge failures isolated from indexing.
- Defaults (`mode: moderate`, ignore list, watched extensions) live in `cordis.patch.yml`; the full table is in the README.
- Watcher records persist in `~/.dsh/dsh-codebase-memory/watcher.json`. Disposal closes handles but keeps intent; DSH Web start re-creates every watcher the user did not explicitly stop.
