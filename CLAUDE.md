# Claude Code handoff

Read `AGENTS.md`, `README.md`, and `PROGRESS.md` before editing. This repository is REAUI, a real local dashboard for the pinned REA reverse-engineering engine, not a design mockup.

## User intent

Provide a polished Codex/OpenWebUI-inspired interface with both Claude Code and ChatGPT Codex integration and access to the complete REA tool surface. Keep implementation, setup, documentation, and meaningful development checkpoints in `FurkanKocatas/REAUI` so work can continue on another computer. Never commit credentials or private analysis data.

## Main commands

```sh
npm ci
npm run setup  # initializes/builds pinned REA and builds UI
npm run dev    # development server on 127.0.0.1:4318
npm test
npm run build
npm start     # production assets + local backend
```

Check `PROGRESS.md` for what has actually been verified. Follow `docs/architecture.md` for the process boundaries. Do not assume external native engines are installed. Prefer real bundled fixtures to fabricated data. The `.data/` directory is machine-local and ignored. Account login must occur on each computer using the official CLIs, never by checking credentials into the repository.

## Important implementation constraints

- Preserve dynamic tool discovery and full JSON results. Schema forms are a convenience; JSON input is the escape hatch.
- Maintain a separate REA MCP session per investigation, shared between UI and the CLI bridge.
- Keep loopback binding, exact Host/Origin validation, browser/bridge token separation, cancellation, and action review.
- Provider process arguments must not silently bypass permissions. Never write global provider configuration or log auth output.
- Do not claim every adapter works on every operating system. Show provider availability and upstream limitations.
- Use a branch for changes to upstream REA; avoid accidental submodule drift. Setup pins its commit and does not recursively fetch optional tool sources.
- Update progress and docs after meaningful changes; commit and push completed checkpoints when authorized by the active user request.
