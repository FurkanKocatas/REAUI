# REAUI · REA Workbench

A local investigation dashboard for [REA](https://github.com/morluto/rea), with a dark chat workspace, a live tool catalog, evidence records, application graphs, and integrations for **ChatGPT Codex** and **Claude Code**.

**Status:** working local dashboard with live Codex/Claude smoke tests, real REA fixture analysis, desktop/mobile browser checks, and ten regression tests. See [PROGRESS.md](PROGRESS.md) for exact verification and remaining limits.

## Run on another computer

Install Git and Node.js **24.18+ (24.x) or 26+** with npm. Then:

```sh
git clone https://github.com/FurkanKocatas/REAUI.git
cd REAUI
npm ci
npm run setup
npm start
```

Open **http://127.0.0.1:4318**. Setup initializes the pinned `vendor/rea` submodule, installs and builds REA using its pinned Node/npm toolchain, and builds the dashboard. Internet access is needed for setup. Optional external engine submodules are not downloaded recursively.

Verified locally on macOS. Linux clean-build checks are defined in GitHub Actions. Native Windows has not been verified; use a compatible Linux/WSL environment for Linux-only adapters.

For development, use `npm run dev` after setup. After pulling updates, run `npm ci && npm run setup` again. The setup script does not install proprietary engines or log into accounts.

## Agent connections

Install [Codex CLI](https://developers.openai.com/codex/cli/) and/or [Claude Code](https://code.claude.com/docs/en/setup), then sign in on that computer:

```sh
codex login
claude auth login
```

Start the dashboard from a terminal where those commands work. **Connections → Refresh** checks installation and sign-in. Select Codex or Claude beneath the message box. Leave the model override blank to use your CLI's configured default. Model availability, provider billing, and subscription limits still apply; Workbench does not supply a model or account.

Both agents receive REA through a local MCP bridge and share the investigation's live engine session. CLI configuration is passed per process, without editing your global MCP configuration. Claude's built-in tools are disabled; Codex runs with a read-only sandbox. Operations with side effects wait for review in the dashboard. Agent requests and selected evidence are sent to the selected provider.

## What you can do

- Create, rename, archive, and resume investigations with persistent chat and analysis history.
- Browse a local file or directory, or upload a file up to 256 MiB into the local workspace.
- Run the bundled Electron sample without a native decompiler or AI account.
- Search the complete tool catalog discovered from REA (191 tools at the pinned version). Configure tools using schema-generated forms or exact JSON.
- Inspect applications, native binaries, supported mobile formats, firmware, recordings, and structured artifacts through the appropriate REA tools.
- Read findings and limitations, inspect graph nodes and relationships, and download complete original JSON results.
- Chat with either CLI agent, review requested operations, stop work, and export an investigation with its evidence.
- Check actual engine and adapter availability on your machine.

Tool availability depends on REA prerequisites. Native decompilation needs a configured engine such as Ghidra, Hopper, or IDA. Some firmware, signal, and packet adapters require Linux. Displaying a tool in the catalog does not mean its dependencies are installed. See [REA installation](https://github.com/morluto/rea/blob/main/docs/installation.md).

## Local data and configuration

The server binds only to `127.0.0.1`; this is a single-user local app, not a hosted multi-user service. It checks Host/Origin and requires distinct browser and agent tokens. It has access to local files and can run REA operations, so do not expose it through a public proxy.

Chats, evidence, uploads, and temporary agent workspaces are stored in `.data/` and excluded from Git. Live MCP state resets after a server restart; saved results remain. The home computer gets code and documentation, **not private investigations or your account credentials**. Export investigations for archival use; importing exports is not implemented yet. To move local history, stop both servers and copy `.data/` privately, then reselect targets whose paths differ.

Environment variables (set in your shell; `.env` is not loaded automatically):

| Variable             | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `PORT`               | Local HTTP port, default `4318`                            |
| `REA_ROOT`           | Use an existing built REA checkout instead of `vendor/rea` |
| `REA_WORKBENCH_DATA` | Override the `.data` storage directory                     |
| `REA_CODEX_COMMAND`  | Codex executable path if absent from PATH                  |
| `REA_CLAUDE_COMMAND` | Claude executable path if absent from PATH                 |

REA's documented engine environment variables are inherited by the engine. Do not commit `.env`, credentials, uploads, or investigation exports.

## Continue development with Claude Code or Codex

Open this repository and ask your agent to read **[CLAUDE.md](CLAUDE.md)**, **[AGENTS.md](AGENTS.md)**, and **[PROGRESS.md](PROGRESS.md)**. The progress file records checkpoints, verification, and remaining work. Run `npm test` and `npm run build` before pushing implementation changes. Keep meaningful checkpoints on `main` unless doing experimental work in a separate branch.

Upstream REA is pinned as a Git submodule to `fb28ec1537e2d02aaca96325483c849c5c8ade6f` (6.4.0), retaining its own license and history. REAUI is an independent interface and is not affiliated with OpenAI, Anthropic, or Open WebUI.
