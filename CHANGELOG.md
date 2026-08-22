# Changelog

## 0.2.0 - 2026-08-22

### Added

- Bridges the Codebase Memory MCP server into DSH via `@deepseek-ai/dsh-mcp-client`, exposing all `mcp__codebase_memory__*` tools natively.
- Second bundle id (`dsh-codebase-memory-watcher`) runs a chokidar watcher per project with debounced rebuilds through the global `codebase-memory-mcp` CLI.
- Watcher HTTP routes: list / status / start / stop / rebuild / restart / auto-attach / cli-info.
- Watcher state persists in `~/.dsh/dsh-codebase-memory/watcher.json` and is restored on DSH Web start unless explicitly stopped.
- Graph UI from the upstream server remains available at `http://127.0.0.1:9749`.
