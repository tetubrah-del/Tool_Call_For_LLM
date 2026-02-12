# Sinkai

Minimal MVP where an AI agent tool_call can hire a registered human for a real‑world task and receive a submission (photo/video/text).

## Documentation

- `docs/README-human-as-a-service.md` (AI向け汎用README)
- `docs/README-property-verification.md` (不動産: Property Verification)
- `docs/README-ugc-capture.md` (広告/UGC: Human-authenticated Content)
- `docs/README-physical-evidence.md` (法務/コンプライアンス: Physical Evidence Collection)
- `docs/SPEC-mcp-for-agents.md` (エージェント向けMCP仕様 v0/v1)
- `docs/WIREFRAME-for-agents-ja.md` (for Agents日本版ワイヤー: コピー/CTA/導線)
- `/for-agents` (エージェント向けLP)
- `/for-agents/quickstart` (最短接続手順)
- `/for-agents/reference` (運用条件・エラー・ライフサイクル)
- `/openapi.json` (公開APIスキーマ)

## Tool Schema (AI)

```json
{
  "name": "call_human",
  "description": "Hire a human to perform a real-world task",
  "parameters": {
    "type": "object",
    "properties": {
      "task": { "type": "string" },
      "origin_country": { "type": "string" },
      "location": { "type": "string" },
      "budget_usd": { "type": "number" },
      "deliverable": {
        "type": "string",
        "enum": ["photo", "video", "text"]
      },
      "deadline_minutes": { "type": "number" }
    },
    "required": ["task", "budget_usd", "origin_country"]
  }
}
```

## API Endpoints

- `POST /api/call_human` (AI tool call)
- `POST /api/humans` (human registration)
- `GET /api/tasks?human_id=...` (human task list)
- `POST /api/tasks/:taskId/accept` (human accepts)
- `POST /api/tasks/:taskId/skip` (human skips)
- `POST /api/submissions` (human delivers)

## Sample AI Tool Call (curl)

```bash
curl -X POST http://localhost:3000/api/call_human \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Take a photo of the nearest public park entrance",
    "location": "Shibuya",
    "budget_usd": 20,
    "deliverable": "photo",
    "deadline_minutes": 30
  }'
```

### Success response

```json
{
  "task_id": "uuid",
  "status": "accepted",
  "eta_minutes": 15
}
```

### Failure response

```json
{
  "status": "rejected",
  "reason": "no_human_available"
}
```

## Human UI

- `/register` to register as a human
- `/tasks?human_id=...` to view and accept tasks
- `/tasks/:taskId?human_id=...` to submit deliverables

## Storage

- SQLite database at `data/app.db`
- Uploaded files stored in `public/uploads`

## Payments (MVP)

- Payment is mocked in `app/api/call_human/route.ts`.
- AI only supplies `budget_usd` and never sees payment processing.

## Run (local)

```bash
npm install
npm run dev
```

## MCP server skeleton (v0 tools)

MCP server scaffold is available under `mcp-server/` and proxies to this app's REST API.

```bash
cd mcp-server
npm install
BASE_URL=http://localhost:3000 npm start
```
