# DSH Codebase Memory

Local DSH bundle that connects [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp) through the official `@deepseek-ai/dsh-mcp-client` bridge.

## Runtime

- `codebase-memory-mcp@0.10.8`
- Windows AMD64 release SHA-256: `b43ad982994c4d829670749e08d3b622a74bb20041fc0a7d02bef6113f81c34d`
- MCP namespace: `mcp__codebase_memory__*`
- Graph UI: http://127.0.0.1:9749

## Install

```powershell
dsh plugin --profile web add @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 link:D:/项目/dsh-codebase-memory
```

Restart the DSH Web host after installation.

## Remove

```powershell
dsh plugin --profile web remove dsh-codebase-memory
```

The global runtime remains pinned independently and can be removed with `npm uninstall -g codebase-memory-mcp`.
