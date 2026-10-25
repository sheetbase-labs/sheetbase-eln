# AI providers, workspace policy and MCP

This page describes the AI layer added on top of the existing AI-01..03
substrate: real provider adapters, the workspace policy that bounds them, the
in-app assistant, and the MCP server that lets an external agent use the
canonical Sheetbase tools.

**No external provider is called by the test suite or by this change's
acceptance run.** The adapters are exercised with an injected `fetch` and
recorded response fixtures. The MCP server is exercised over loopback against
the local application and a disposable personal token. Live-provider quality,
latency and cost are therefore **unexercised** and must be measured before a
production claim.

## What is in place

| Layer               | Module                                                            | What it owns                                                                                                                             |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Provider adapters   | `src/lib/ai-providers/`                                           | OpenRouter, Anthropic Messages, generic OpenAI-compatible and local endpoints. Request/response mapping, usage and cost, bounded errors. |
| Deployment profiles | `src/lib/ai-providers/config.server.ts`                           | Parses `AI_PROVIDER_PROFILES`, resolves a profile's key from the server environment, refuses malformed profiles.                         |
| Workspace policy    | `api.workspace_settings.ai_*`, `src/lib/ai-settings.ts`           | Kill switch, selected profile, model role, cloud-egress consent, per-call token/cost limits.                                             |
| Governed call       | `src/lib/ai-gateway.ts`, `src/lib/assistant.ts`                   | Allowlist, actor match, budgets, hash-only telemetry, grounded context, source projection. No writes.                                    |
| Assistant UI        | `src/components/assist/assistant-panel.tsx`                       | One global panel, a page-header entry point, a shell trigger and ⌘J.                                                                     |
| MCP                 | `src/lib/mcp/`, `src/routes/api/mcp.ts`                           | JSON-RPC 2.0 over Streamable HTTP (JSON responses), scoped tools, domain resources and prompts.                                          |
| Skills              | `.agents/skills/sheetbase-domain`, `.agents/skills/sheetbase-mcp` | One domain description for coding agents; the MCP resources serve the same text.                                                         |

## Provider profiles

Profiles are deployment configuration, never user input and never secret. Each
profile names the environment variable that holds its key.

```json
{
  "profiles": [
    {
      "id": "openrouter-default",
      "label": "OpenRouter",
      "kind": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "anthropic/claude-sonnet-4.5",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "pricing": {
        "inputMicrousdPerMillionTokens": 3000000,
        "outputMicrousdPerMillionTokens": 15000000
      },
      "maxOutputTokens": 4096
    },
    {
      "id": "claude",
      "label": "Anthropic",
      "kind": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "model": "claude-sonnet-4-5",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "pricing": {
        "inputMicrousdPerMillionTokens": 3000000,
        "outputMicrousdPerMillionTokens": 15000000
      }
    },
    {
      "id": "local-ollama",
      "label": "Local Ollama",
      "kind": "local",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "llama3.1:8b",
      "pricing": {
        "inputMicrousdPerMillionTokens": 0,
        "outputMicrousdPerMillionTokens": 0
      }
    }
  ]
}
```

Rules enforced at parse time:

- cloud kinds (`openrouter`, `anthropic`, `openai-compatible`) require
  `https:` and an `apiKeyEnv`;
- `local` may use `http:` and needs no key;
- the base URL may not carry credentials, a query string or a fragment;
- ids are unique and lower-case kebab-case;
- pricing is integer micro-USD per million tokens. `0` is valid for a local
  model. The provider's reported usage is the authoritative cost; the profile
  rate is only the gateway's pre-call estimate.

`AI_PROVIDER_PROFILES` unset means no external provider is configured. The
assistant then uses the built-in deterministic model, which exercises the full
gateway policy path but is clearly labelled in the UI. It is not a live model.

## Workspace policy

A workspace owner sets the policy at **Settings → AI**:

- **Enable the assistant** — the workspace kill switch. Off means no assistant
  request is served, even if a provider is configured.
- **Provider profile** — a deployment profile, or the built-in model.
- **Model role** — `sheetbase-assist-1` or `sheetbase-summarise-1`. The
  gateway allowlist decides the role; the profile supplies the concrete model.
- **Cloud-egress consent** — required before a cloud profile can serve a
  request. The consent is stored on the workspace and audited with the settings
  change.
- **Maximum tokens/cost per call** — the gateway rejects a call before it leaves
  the server if the estimated context cannot fit, and rejects it again if the
  provider reports more usage than the cap.

Provider keys stay in the deployment environment. The workspace row stores only
the profile id, the model role, the consent flag and the caps. A deployment that
has not set the key for a selected profile reports `key_missing` rather than
falling back silently.

## MCP

`POST /api/mcp` speaks MCP protocol `2025-06-18` and returns JSON responses.
It does not offer a server-initiated SSE stream, so `GET` is refused.

Authentication is an existing personal or service credential:

```
Authorization: Bearer sb_<prefix>_<secret>
```

The same `verifyCredential` function that serves `/api/token` validates the
credential: revocation, expiry, personal-token membership and rate limiting are
identical. A personal token acts as its creating member under member RLS; a
service token acts as the workspace service identity.

Discovery is scope-filtered:

- read tools need their own read scope (`datasets:read`, `sheets:read`,
  `projects:read`, `models:read`);
- draft tools need `agent_operations:write` **and** the operation's own write
  scope (`schema:write`, `pipelines:write` or `datasets:write`);
- a token that lacks the write scope is not shown the tool, and a direct call is
  refused before the proposal RPC. This is deliberate: the proposal RPC can
  auto-execute a safe draft under the acting person's capabilities, so an
  `agent_operations:write`-only token must not reach it.

Tools are the existing AUTO-PLUS-01 catalogue plus one read-only context tool
(`sheetbase.context.assemble`). Drafts and mutations go through
`propose_agent_operation`; there is no direct table access and no arbitrary RPC.
Approval, execution, submission, signing, publication and workflow resume stay
human-only.

Domain knowledge is served as `sheetbase://domain/*` resources and as
`sheetbase.*` prompts. The single source is `src/lib/ai-knowledge.ts`; the
`.agents/skills/sheetbase-domain` and `.agents/skills/sheetbase-mcp` skills
point at the same text so a coding agent, a hosted MCP client and the in-app
assistant cannot drift.

## Security and privacy

- Prompts, responses and keys are never logged. The gateway logs a prompt hash,
  character count, estimated/actual tokens and cost, citation ids and the actor.
- `redact()` strips secret-shaped keys; the opt-in debug excerpt is capped and
  scrubbed, and is for local reproduction only.
- Provider errors carry the HTTP status, never the response body, because an
  upstream error can echo the prompt.
- Provider requests disable redirects and cache, and have a timeout. There are
  no retries: a retry can double spend.
- Cloud egress is per workspace and explicit. Files are not part of the context
  envelope; dataset row sampling is off unless a caller asks for it and the
  budget allows.
- AI output is labelled and cited. It never signs, approves, submits or
  executes. The assistant panel has no write action.

## Evidence in this change

- `src/lib/ai-providers.test.ts` — profile validation and the four
  request/response contracts with an injected `fetch`; no network.
- `src/lib/mcp/handler.test.ts` — protocol, scope-filtered discovery, read
  mapping, draft wrapping, under-scoped refusal, resources and prompts.
- `src/lib/assistant.test.ts` — policy, grounding, no-write, provider injection,
  budget rejection.
- `src/lib/ai-context.test.ts` — the existing context contract, plus dataset
  titles now use the dataset name rather than its UUID.
- `tests/browser/ai-assistant.test.ts` — owner enables the assistant, asks from
  a dataset page, sees the cited source, and the dataset revision is unchanged;
  the kill-switch state is shown from the page-header entry point.
- A loopback MCP probe (not committed) recorded: unauthenticated `401`,
  `initialize` `200` with protocol `2025-06-18`, a `datasets:read` token seeing
  only the context and dataset read tools, two of eighteen dataset rows read,
  and an under-scoped draft refused with
  `This credential lacks the write scope required to propose this operation: pipelines:write.`

## Known limits

- **No live provider call has been made.** Adapter behaviour against a real
  OpenRouter, Anthropic, OpenAI or local endpoint is unverified. Recorded
  fixtures prove the mapping, not the vendor's current API.
- BYO workspace keys are not implemented. Profiles are deployment-owned; key
  custody is the deployment operator's.
- MCP uses bearer credentials, not OAuth 2.1 discovery. A hosted connector that
  requires dynamic client registration needs that additional slice.
- There is no streaming, no retry, no embeddings index and no monthly budget
  counter. Per-call caps are enforced; cumulative spend is visible in metrics
  but not blocked.
- The built-in deterministic model is a fixture. It demonstrates the pipeline,
  not answer quality.
