# Human-as-a-Service API (AI)

Minimal API where an AI agent tool_call can hire a registered human for a real-world task and receive a submission (photo/video/text).

---

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

---

## API Endpoints

- `POST /api/call_human` (AI tool call)
- `POST /api/humans` (human registration)
- `GET /api/tasks?human_id=...` (human task list)
- `GET /api/tasks/:taskId` (task status)
- `GET /api/task/:taskId` (task status, alias)
- `POST /api/tasks/:taskId/accept` (human accepts)
- `POST /api/tasks/:taskId/skip` (human skips)
- `POST /api/tasks/:taskId/pay` (admin marks paid)
- `POST /api/submissions` (human delivers)

---

## Sample AI Tool Call (curl)

```bash
curl -X POST http://localhost:3000/api/call_human \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Take a photo of the nearest public park entrance",
    "origin_country": "JP",
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

---

## Task lifecycle

```
open -> accepted -> completed
open -> failed
accepted -> failed
```

Timeouts are enforced by a server-side sweeper while the process is running.

---

## Task status response (GET /api/tasks/:taskId)

```json
{
  "task": {
    "id": "uuid",
    "task": "Take a photo of the nearest public park entrance",
    "location": "Shibuya",
    "budget_usd": 20,
    "deliverable": "photo",
    "task_display": "Shibuya駅近くの公園入口の写真を撮ってください。",
    "lang": "ja",
    "deadline_at": "2026-02-06T03:15:00.000Z",
    "status": "accepted",
    "failure_reason": null,
    "human_id": "uuid",
    "created_at": "2026-02-06T02:45:00.000Z",
    "submission": {
      "id": "uuid",
      "task_id": "uuid",
      "type": "photo",
      "content_url": "https://...",
      "text": null,
      "created_at": "2026-02-06T03:05:00.000Z"
    }
  }
}
```

---

## i18n (human UI only)

- Internal data is stored in English (`task_en`) and never translated in-place.
- UI requests pass `lang=en|ja` and receive `task_display` plus `lang`.
- Translations are cached in `task_translations` and reused.

---

## Deliverables

Deliverables are returned in `submission` via `GET /api/tasks/:taskId`.

```json
{
  "type": "photo",
  "content_url": "https://..."
}
```

or

```json
{
  "type": "text",
  "text": "The building exists and the nameplate matches."
}
```

### Submission example

```json
{
  "submission": {
    "id": "uuid",
    "task_id": "uuid",
    "type": "text",
    "content_url": null,
    "text": "Done.",
    "created_at": "2026-02-06T09:24:05.986Z"
  }
}
```

### Failure reasons (enum)

- `no_human_available`
- `timeout`
- `invalid_request`
- `below_min_budget`
- `missing_origin_country`
- `wrong_deliverable`
- `already_assigned`
- `not_assigned`
- `missing_human`
- `not_found`
- `unknown`

---

## Human UI

- `/register` to register as a human
- `/tasks?human_id=...` to view and accept tasks
- `/tasks/:taskId?human_id=...` to submit deliverables
- `country` is required on human registration (ISO2, e.g., `JP`).

---

## Storage

- SQLite database at `data/app.db`
- Uploaded files stored in `public/uploads`

---

## Payments (MVP)

- Payment is mocked in `app/api/call_human/route.ts`.
- AI only supplies `budget_usd` and never sees payment processing.
- Minimum budget is `$5`.

### Admin payments (manual)

1. Open `/payments` (admin UI).
1. Set `ADMIN_TOKEN` in the environment and enter it in the admin UI.
2. Find completed tasks under **Unpaid**.
3. Enter PayPal fee (USD). Use `0` for domestic.
4. Click **Mark Paid** after sending payout.
5. Export CSV from **Export CSV** for bookkeeping.

### Mark paid (admin)

```json
POST /api/tasks/:taskId/pay
{
  "paypal_fee_usd": 0
}
```

Response includes `fee_amount` (20% ceiling), `payout_amount`, and `paid_at`.

---

## Run (local)

```bash
npm install
npm run dev
```
