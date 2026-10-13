# Repository guidelines

Read README.md, CLAUDE.md, PROGRESS.md, and docs/architecture.md for context.

Keep this a functional local desktop-browser application. UI actions must be wired to real behavior; report unavailable capabilities honestly. Never store secrets, user artifacts, `.data`, node_modules, or build outputs in Git. Preserve upstream REA as a pinned submodule.

Use React/Vite for the interface and Node ESM for the local HTTP/MCP bridge. Preserve accessible labels, keyboard navigation, responsive layout, and the restrained dark visual style. Avoid unnecessary dependencies.

Validate meaningful behavior with Node tests and a production build. For UI changes, use the browser to inspect the rendered result and exercise the affected flow. Test actual REA fixtures for engine changes. Keep external provider usage small and report whether tests used real accounts or fixtures.

Document limitations and update PROGRESS.md so another agent can resume without relying on chat history. Use descriptive Git commits at working checkpoints. Do not add autonomous multi-agent behavior.
