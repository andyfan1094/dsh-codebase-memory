# Security notes

- The plugin runs the local `codebase-memory-mcp` binary on this machine; it does not talk to any cloud service.
- The release binary is pinned by SHA-256 in the README. Verify the hash after downloading a new upstream release.
- The watcher shells out to the `codebase-memory-mcp` CLI for rebuilds; index scope is limited to the repository paths you register.
- The Graph UI binds to loopback (127.0.0.1:9749). Do not expose it to other network interfaces.
- Watcher state in `~/.dsh/dsh-codebase-memory/watcher.json` contains local paths only.

Report vulnerabilities or security-relevant bugs through GitHub issues; avoid posting secrets or internal hostnames in reports.
