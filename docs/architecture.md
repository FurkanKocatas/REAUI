# Architecture

`src/App.jsx` implements the React shell, investigations, tool forms, evidence viewer, graph, filesystem picker, and connection status. `src/lib.js` contains schema helpers and API calls. Vite serves development modules and produces `dist/` for production.

`server/index.mjs` binds a Node HTTP server to loopback, authenticates requests, persists sessions/runs, streams events with SSE, and coordinates approvals/cancellation. `server/store.mjs` writes metadata and unmodified MCP results under `.data/`. Incomplete work becomes interrupted on restart.

`server/rea.mjs` launches the pinned upstream REA stdio MCP server. It owns one MCP connection per investigation and discovers schemas dynamically. A catalog connection handles initial tool discovery and general availability.

`server/agents.mjs` starts signed-in Codex/Claude CLIs, passes bounded conversation context, and parses their JSONL event output. Agent text and tool activity stream to the browser. Each CLI gets `server/bridge.mjs` as its per-run MCP server. The bridge forwards MCP calls through authenticated loopback HTTP to the same investigation's REA connection, recording tool calls as evidence and pausing side-effecting operations for review.

Code paths never accept arbitrary shell command strings from HTTP. Tool names must exist in REA's catalog. REA itself has powerful runtime/file operations; the review gate and upstream constraints matter. Local process users are trusted. Host/Origin checks and tokens protect against unrelated websites, not against malicious local users.

An exported investigation is a Workbench JSON archive, distinct from REA's own export tools. Full results are preserved on disk even when visual previews and graphs are bounded. Chat history sent to an agent is limited to the latest 30 messages / approximately 100,000 characters plus recent run summaries; CLI-native session resumption is not used.
