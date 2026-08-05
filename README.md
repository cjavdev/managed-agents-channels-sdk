# cma-channels-sdk

A Slack bot built on the [CopilotKit Channels SDK](https://www.copilotkit.ai/channels-guide.md), backed by a **Claude Managed Agent** — Anthropic runs the agent loop and a per-session sandbox (bash, files, web search); this service is a thin bridge between Slack threads and Managed Agent sessions.

```
Slack ⇄ CopilotKit Intelligence (managed transport)
              ⇄ this service (channel handlers)
                    ⇄ Anthropic Managed Agents API (sessions + SSE events)
```

- Each Slack thread maps to one persistent Managed Agent **session** (mapping in `.data/sessions.json`), so conversation memory lives server-side and survives restarts.
- A mention subscribes the thread and answers; follow-ups in a subscribed thread get replies without a mention; fresh unmentioned conversations stay silent.
- Replies stream into Slack progressively (`thread.stream`), one chunk per agent message.

## Layout

| Path | Purpose |
|---|---|
| `cma/agent.yaml`, `cma/environment.yaml` | Version-controlled Managed Agent + environment definitions, applied with the `ant` CLI |
| `src/cma.ts` | Session bridge: create/reuse sessions, stream-first event drain, timeouts, stale-session recovery |
| `src/channel.ts` | `createChannel` + `onMention`/`onMessage` handlers |
| `src/agui-agent.ts` | AG-UI `AbstractAgent` adapter over the same bridge (the runtime's `agents.default`) |
| `src/main.ts` | `CopilotRuntime` + Node listener + lifecycle |
| `scripts/smoke.ts` | Live end-to-end test of the bridge (no Slack needed) |

## Already provisioned

| Resource | ID |
|---|---|
| Managed Agent (`Slack Channel Assistant`, claude-opus-5) | `agent_01LqJDrLwkXdV9KoCvV5QaRc` |
| Environment (`channels-slack`, cloud, unrestricted egress) | `env_01QHewHxknwT5vmJ5pFF48Px` |

Both IDs are in `.env`. To change the agent's prompt/tools, edit `cma/agent.yaml` and run:

```bash
ant beta:agents update --agent-id agent_01LqJDrLwkXdV9KoCvV5QaRc --version <current> < cma/agent.yaml
```

Anthropic auth comes from your `ant auth login` profile (or `ANTHROPIC_API_KEY`); the SDK picks it up automatically.

## Remaining setup (Slack side — one-time, interactive)

1. **Log in to CopilotKit** (opens a browser):
   ```bash
   npx copilotkit@latest login
   npx copilotkit@latest whoami        # must show account + org
   npx copilotkit@latest project select # if no hosted project is selected
   ```
2. **Provision the Slack channel** (channel code must match `CHANNEL_NAME` in `.env`):
   ```bash
   npx copilotkit@latest channels add \
     --name cma-assistant \
     --display-name "CMA Assistant" \
     --adapter slack \
     --json
   ```
   The JSON result's `nextAction` gives a prefilled **Slack manifest link** and the exact `requiredEnvVars`.
3. **Create the Slack app** from the manifest link (saved at
   `.copilotkit/artifacts/cma-assistant/slack-app-create-url.txt`), then:
   - OAuth & Permissions → **Reinstall to Workspace** → Allow (this grants all 17 scopes; the initial create grants only 2)
   - Copy the **Bot User OAuth Token** (OAuth & Permissions) and **Signing Secret** (Basic Information → App Credentials) — *after* reinstalling; reinstalling issues a new token
   - Put both in `.env` as `INTELLIGENCE_CHANNEL_CMA_ASSISTANT_SLACK_BOT_TOKEN` / `INTELLIGENCE_CHANNEL_CMA_ASSISTANT_SLACK_SIGNING_SECRET` (the Intelligence API key was already written by `copilotkit init` as `INTELLIGENCE_API_KEY`)
4. **Resume** with `npx copilotkit@latest channels add cma-assistant --adapter slack --json`, then verify:
   ```bash
   npx copilotkit@latest channels status --json
   ```
   If diagnostics report `hosted_gateway_ws_url_missing`, set `COPILOTKIT_INTELLIGENCE_WS_URL` in `.env` to the gateway URL your project's environment contract names — `channels.ready()` hangs without it.

## Run

```bash
npm run typecheck   # tsc, no emit
npm run smoke       # live Managed Agent turn, no Slack required
npm run dev         # start the bridge; waits for the channel to come online
```

`npm run dev` starts the long-running service, activates the managed Slack transport, and logs when the channel reports `online`. There is no hot-reload — restart after any handler/agent change and re-verify `online`.

## Validation (from a human Slack account)

1. `/invite @cma-assistant` to a channel, mention it → expect a useful reply.
2. Send an unmentioned follow-up in that thread → expect a reply.
3. Send an unmentioned message in a fresh conversation → expect silence.

## Notes & limits

- Turns are capped at 5 minutes (`CMA_TURN_TIMEOUT_MS`); a timed-out turn posts a short notice instead of hanging.
- If a stored session was deleted/terminated, the bridge transparently creates a fresh one for that thread.
- Inbound attachments are currently ignored (text-only prompts); the Managed Agents API accepts image/document blocks if you want to extend `src/cma.ts`.
- Session traces are viewable in the Anthropic Console (URL logged on session creation).
