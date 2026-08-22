# Watcher API examples

All routes are registered under `/api/dsh-codebase-memory/watcher/*` when the webServer service is available. Examples below assume the default loopback address.

```powershell
$base = 'http://127.0.0.1:3080/api/dsh-codebase-memory/watcher'

# List every persisted watcher with status and last-run info
Invoke-RestMethod ($base + '/list')

# Start a watcher for one repository
Invoke-RestMethod -Uri ($base + '/start') -Method Post -ContentType 'application/json' -Body '{"repoPath":"D:\\projects\\demo"}'

# Force an immediate rebuild
Invoke-RestMethod -Uri ($base + '/rebuild') -Method Post -ContentType 'application/json' -Body '{"id":"<id>"}'

# Recreate watchers for every project the MCP server already knows
Invoke-RestMethod -Uri ($base + '/auto-attach') -Method Post

# Show which codebase-memory-mcp executable will be used for rebuilds
Invoke-RestMethod ($base + '/cli-info')
```

## Troubleshooting

- **Edits are not picked up**: check `/list` for `status` and `lastError`, then force `/rebuild`. Native notifications can miss events on network drives; enable `usePolling` in `cordis.patch.yml` at the cost of CPU and disk activity.
- **Watchers are missing after a host restart**: only watchers you did not explicitly stop are restored automatically. Use `/restart` to relaunch non-stopped ones or `/auto-attach` to cover every known MCP project.
- **Rebuilds fail with CLI errors**: `/cli-info` reports the resolved `codebase-memory-mcp` executable; make sure the global install matches the pinned runtime version in the README.
