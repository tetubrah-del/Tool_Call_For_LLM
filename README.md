# Call Human MVP

Minimal MVP where an AI agent tool_call can hire a registered human for a real‑world task and receive a submission (photo/video/text).

## Tool Schema (AI)

```json
{
  "name": "call_human",
  "description": "Hire a human to perform a real-world task",
  "parameters": {
    "type": "object",
    "properties": {
      "task": { "type": "string" },
      "location": { "type": "string" },
      "budget_usd": { "type": "number" },
      "deliverable": {
        "type": "string",
        "enum": ["photo", "video", "text"]
      },
      "deadline_minutes": { "type": "number" }
    },
    "required": ["task", "budget_usd"]
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
