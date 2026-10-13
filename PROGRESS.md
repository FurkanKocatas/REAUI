# Development handoff

## Checkpoint 1 — 2026-10-13

Repository established at `FurkanKocatas/REAUI`, with pinned REA 6.4.0 submodule and repeatable setup script. Implemented HTTP server, local persistence, dynamic MCP catalog, investigation sessions, approvals/cancellation, upload/file browsing, export, provider status and CLI bridges. React interface includes investigation/chat, tools, evidence/graph, connection status, and dialogs.

**Work in progress:** CSS, integrated browser checks, backend regression tests, and real CLI bridge smoke tests are still pending at this checkpoint. Do not interpret this initial commit as a verified release.

Verified upstream separately: REA builds and its bundled Electron fixture analyzes successfully; installed Codex and Claude CLIs on the original development machine report signed in. Native decompiler engines are not configured there. Credentials and investigation files are intentionally excluded from Git.

## Checkpoint 2 — working dashboard and real integrations

- Finished dark responsive interface, bundled local fonts, mobile navigation, tool forms with JSON input, filesystem browser, evidence viewer, and interactive graph with pan/zoom/node selection.
- Ran `npm run setup` using the repository's pinned submodule; both engine and production UI built successfully on macOS (host Node 26; engine build Node 24.18 / npm 11.16).
- Ran actual Codex and Claude Code CLI smoke tests through the dashboard: each called `binary_session` through the MCP bridge, produced a saved completed tool run, and returned `open: false` in its response. No credentials were copied or committed.
- Ran actual Electron sample analysis: 6 relevant files, 22 findings, graph nodes/edges and original evidence JSON preserved.
- Ten regression tests pass: HTTP authentication and Host/Origin boundaries, real REA catalog/analysis/export, review refusal, local upload paths, persistence/restart behavior, schema defaults and nullable form values, MCP bridge forwarding/error handling, and React rendering of all 191 live tool forms plus the actual graph and Connections page.
- Added GitHub Actions for clean setup/build/tests/format verification.

### Remaining verification and limits

Browser QA completed after an initial preview attachment failure: inspected desktop (1280×720) and mobile (390×844) rendering; ran the sample from the UI; opened evidence and graph; selected a graph node; searched tools; switched a nullable schema between form and JSON; selected a local folder; switched to Claude; and opened Connections from mobile navigation. Fixed a short-window layout issue and a nullable-default parsing bug found during these checks. Graph visual preview fits shorter windows and nodes remain keyboard-addressable.

Native decompiler integrations and Linux-specific hardware/recording adapters require external setup and were not tested. Windows-native behavior is not verified. Large catalogs add substantial model context, especially in Claude; a future improvement is optional progressive tool discovery while retaining the complete manual catalog. Conversation context is bounded; graph preview caps at 80 nodes, but complete JSON downloads retain every node. Export archives are supported; importing them is not implemented.

### Suggested next work

1. Expand browser coverage for long conversations, file uploads, interruption/reconnect, and agent approval interactions.
2. Configure a native analysis engine on the intended machine and test an actual binary.
3. If needed, add portable investigation import with path remapping and optional progressive tool discovery for lower agent context usage.

## Checkpoint 3 — clean-machine verification and handoff

Implementation commit `9c0e89d` passed the [fresh Ubuntu GitHub Actions run](https://github.com/FurkanKocatas/REAUI/actions/runs/38397991580): checkout with pinned submodule, Node 24.18, `npm ci`, full `npm run setup`, ten tests, and formatting. This verifies the documented home-computer setup without relying on the original machine's sibling REA checkout.

The original development machine now runs `npm start` from this repository, using its own `vendor/rea` engine and production assets at `http://127.0.0.1:4318`. Both local provider connections report signed in. A fresh sample investigation was created through the production UI. Development-only integration sessions were archived locally; their evidence remains available. Local workspace data and credentials are not part of Git.

To resume at home: clone, `npm ci`, `npm run setup`, sign into the desired CLI(s), then `npm start`. Give Claude Code this repository and tell it to read `CLAUDE.md` and this progress file. Do not assume the previous machine's target paths exist.
