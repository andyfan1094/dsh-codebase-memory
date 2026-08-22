import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Resolve the codebase-memory-mcp executable. We rely on the same global
// install the MCP-client bundle uses (see cordis.patch.yml). One CLI
// invocation launches its own short-lived .exe process — startup cost is a
// few seconds, which we accept to keep the bridge dependency-free.

function resolveExecutable() {
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'codebase-memory-mcp', 'bin', 'codebase-memory-mcp.exe'),
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx', 'node_modules', 'codebase-memory-mcp', 'bin', 'codebase-memory-mcp.exe'),
      'C:/Program Files/nodejs/node_modules/codebase-memory-mcp/bin/codebase-memory-mcp.exe',
    ]
    for (const candidate of candidates) if (existsSync(candidate)) return candidate
    return candidates[0] // fall back; spawn will surface a clear error
  }
  const candidates = [
    '/usr/local/lib/node_modules/codebase-memory-mcp/bin/codebase-memory-mcp',
    '/usr/lib/node_modules/codebase-memory-mcp/bin/codebase-memory-mcp',
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return candidates[0]
}

export function createCliBridge({ executable = resolveExecutable(), timeoutMs = 600_000 } = {}) {
  return {
    executable,

    // Run `codebase-memory-mcp cli <tool_name> '<json_args>'` and return
    // parsed JSON on success. Throws with a wrapped error on failure so
    // callers can surface the message in watcher state.
    async callTool(toolName, args = {}) {
      const jsonArgs = JSON.stringify(args)
      return new Promise((resolve, reject) => {
        const child = spawn(executable, ['cli', toolName, jsonArgs], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          try { child.kill() } catch { /* ignore */ }
          fn(value)
        }

        const timer = setTimeout(() => {
          finish(reject, new Error(`codebase-memory-mcp cli ${toolName} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })

        child.on('error', (err) => {
          clearTimeout(timer)
          finish(reject, new Error(`codebase-memory-mcp cli ${toolName} spawn failed: ${err.message}`))
        })

        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0) {
            const message = stderr.trim() || `exit code ${code}`
            finish(reject, new Error(`codebase-memory-mcp cli ${toolName} failed: ${message}`))
            return
          }
          // The CLI prints a single JSON object on success.
          const trimmed = stdout.trim()
          if (trimmed === '') {
            finish(resolve, null)
            return
          }
          try {
            finish(resolve, JSON.parse(trimmed))
          } catch (err) {
            finish(reject, new Error(`codebase-memory-mcp cli ${toolName} returned non-JSON: ${trimmed.slice(0, 200)}`))
          }
        })
      })
    },

    async listProjects() {
      const result = await this.callTool('list_projects', {})
      return result && Array.isArray(result.projects) ? result.projects : []
    },

    async indexRepository(repoPath, mode = 'moderate') {
      return await this.callTool('index_repository', { repo_path: repoPath, mode })
    },

    async indexStatus(projectName) {
      try {
        return await this.callTool('index_status', { project: projectName })
      } catch (err) {
        return { error: err.message }
      }
    },
  }
}
