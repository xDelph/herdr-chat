![Herdr Chat](docs/banner.png)

**Pilot Herdr and its agents from your phone.** Herdr Chat is a PWA that reads your
Pi and codex sessions and lets you drive them from anywhere in your tailnet.

No SSH. No terminal on the phone. Nothing is copied out of your machine.

## What it does

- **Conversations, not terminals.** Each agent's session is rendered as it actually
  reads: messages, thinking, tool calls, diffs, subagent results. Long output stays
  folded.
- **Answers you when you are not looking.** Push notifications tell you when an agent
  finishes — and says *"needs you"* when it is waiting on a question, instead of
  claiming it is done.
- **Questions, with their choices.** When an agent blocks on a prompt, Herdr Chat
  reads it off the screen and shows the real options as buttons.
- **Send, answer, stop, change model.** All through Herdr's own API, with the same
  confirmations — nothing is reported as sent until the transport says so.
- **Honest by default.** A missing value is shown as missing. An error carries its
  cause. Nothing is invented to fill a gap.

## Requirements

- **Herdr** running on the same machine (`~/.config/herdr/herdr.sock`).
- **[Tailscale](https://tailscale.com)** for remote access. The server binds to
  `127.0.0.1` only — Tailscale Serve is the single supported way in.

## Install

```bash
brew trust xDelph/herdr-chat     # newer Homebrew asks before loading third-party taps
brew install xDelph/herdr-chat
brew services start herdr-chat
```

Then expose it to your tailnet:

```bash
tailscale serve --bg --https=8790 http://127.0.0.1:8791
```

Open `https://<your-machine>.<tailnet>.ts.net:8790` on your phone and add it to the
home screen. It installs as a normal app: its own icon, no Safari chrome.

## How it fits together

```text
iPhone ── Tailscale ── Serve :8790 ── 127.0.0.1:8791 ── Herdr Chat
                                                            │
                                                            ├── Herdr socket  (control)
                                                            └── Pi/codex JSONL (content)
```

**Herdr stays the orchestrator.** Herdr Chat is a local layer: it reads, displays and
forwards. It never replaces Herdr and never starts a second agent behind your back.

Content and catch-up come from the **session files**, never from the API — Herdr's
`revision` is always `0` and only one event type is implemented. Control and status
come from the **socket**. See `docs/PROTOCOL.md` for what was measured, and
`docs/DECISIONS.md` for why.

## Configuration

Every variable is optional — a bare install works.

| Variable | Default | Purpose |
|---|---|---|
| `HERDR_REMOTE_BIND` | `127.0.0.1` | Interface to bind. Never expose publicly. |
| `HERDR_REMOTE_PORT` | `8791` | Local port |
| `HERDR_REMOTE_PUBLIC_ORIGINS` | derived | Extra allowed origins, comma-separated |
| `HERDR_REMOTE_LOG_PATH` | `~/.herdr-remote/herdr-remote.log` | Error journal |
| `HERDR_REMOTE_PUSH_STORE` | `~/.herdr-remote/push.json` | Push subscriptions |
| `PI_SESSIONS_ROOT` / `CODEX_SESSION_ROOT` | `~/.pi/…`, `~/.codex/…` | Session roots |

The VAPID key pair for push notifications is generated on first run and stored
alongside the subscriptions.

## Development

```bash
nvm use          # reads .nvmrc
bun install
bun run verify   # format → lint → typecheck → tests
bun run dev      # Vite dev server
```

`bun run verify` must be green before any commit. The test suite is the design
contract: each test carries a requirement id, and changing a rule is expected to
break a test.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free for personal and noncommercial use.
Commercial use requires a separate license.
