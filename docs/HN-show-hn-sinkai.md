# Show HN Launch Pack (Sinkai)

Last updated: 2026-02-20

## 1) Submission URL

- Target URL: `https://sinkai.tokyo/for-agents`
- Optional reference: `https://sinkai.tokyo/openapi.json`
- HN submit page: `https://news.ycombinator.com/submit`

## 2) Recommended title

`Show HN: Sinkai – Let AI agents hire humans for real-world tasks`

Alternative:
`Show HN: Sinkai (MCP/OpenAPI) – AI agents can call humans for physical tasks`

## 3) First comment template (paste right after submitting)

I built Sinkai to handle tasks that pure software agents cannot complete alone (for example, on-site checks, physical evidence collection, and local human verification).

What it does:
- AI agent sends a tool call (`POST /api/call_human`)
- Human accepts task and submits photo/video/text proof
- Agent receives structured result for downstream workflow

Current focus:
- Reliability at handoff boundaries (planner -> executor -> verifier)
- Human-in-the-loop operations with explicit failure states
- MCP/OpenAPI friendly integration for agent builders

Docs and API:
- for agents: https://sinkai.tokyo/for-agents
- openapi: https://sinkai.tokyo/openapi.json
- repo: https://github.com/tetubrah-del/Tool_Call_For_LLM

I would love feedback on:
1. trust/reliability signals you would require before production use
2. where to draw the boundary between autonomous execution and human escalation
3. failure modes we should expose more clearly in API responses

## 4) Quick answers for expected HN questions

### Q: What is new vs existing task marketplaces?
Short answer:
- Built from agent tool-call entrypoint first, not human app first.
- Designed around machine-readable failure/timeout states for orchestration.
- Explicit handoff semantics (who owns next action, and when).

### Q: Is there a live demo?
Short answer:
- Yes, public docs + API schema are live:
  - https://sinkai.tokyo/for-agents
  - https://sinkai.tokyo/openapi.json

### Q: Safety / abuse controls?
Short answer:
- Strict status transitions and constrained deliverable types in MVP.
- Human escalation and verification are explicit steps, not hidden retries.
- Secrets are not embedded in client examples; API key handling is isolated.

### Q: What should people test first?
Short answer:
- Start with `/for-agents/quickstart` and perform one small scoped task.
- Validate rejection and timeout paths, not only success.

## 5) Suggested posting sequence

1. Submit URL post with title (`Show HN: ...`).
2. Immediately add first comment (template above).
3. Stay online for first 60-90 minutes and respond quickly.
4. Prioritize technical criticism and concrete failure reports.
