# Human-as-a-Service API (AI)

Minimal API where an AI agent tool_call can hire a registered human for a real-world task and receive a submission (photo/video/text).

---

## Database

- Local development defaults to SQLite at `data/app.db`.
- Set `DATABASE_URL` to use Postgres (recommended for production persistence).
- Render Postgres typically requires SSL; include `sslmode=require` in the URL or set `PGSSLMODE=require`.

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
      "ai_account_id": { "type": "string" },
      "ai_api_key": { "type": "string" },
      "origin_country": { "type": "string" },
      "task_label": {
        "type": "string",
        "enum": [
          "real_world_verification",
          "jp_local_research",
          "ai_output_qa",
          "bot_blocker_ops",
          "lead_prep"
        ]
      },
      "acceptance_criteria": { "type": "string" },
      "not_allowed": { "type": "string" },
      "location": { "type": "string" },
      "budget_usd": { "type": "number" },
      "deliverable": {
        "type": "string",
        "enum": ["photo", "video", "text"]
      },
      "deadline_minutes": { "type": "number" }
    },
    "required": [
      "task",
      "ai_account_id",
      "ai_api_key",
      "budget_usd",
      "origin_country",
      "task_label",
      "acceptance_criteria",
      "not_allowed"
    ]
  }
}
```

---

## API Endpoints

- `POST /api/call_human` (AI tool call)
- `POST /api/ai/accounts` (AI account + PayPal connect)
- `POST /api/humans` (human registration)
- `GET /api/tasks?human_id=...` (human task list)
- `GET /api/tasks?human_id=...&task_label=...&q=...` (human task search)
- `GET /api/tasks/:taskId` (task status)
- `GET /api/task/:taskId` (task status, alias)
- `POST /api/tasks/:taskId/approve` (AI requester final approval)
- `POST /api/tasks/:taskId/reject` (AI requester rejection within review window)
- `POST /api/tasks/:taskId/accept` (human accepts)
- `POST /api/tasks/:taskId/skip` (human skips)
- `POST /api/submissions` (deliver; requires auth as assigned human or task's AI)
- `GET /api/me/photos` (my-page photo list)
- `POST /api/me/photos` (my-page photo upload)
- `PATCH /api/me/photos/:photoId` (my-page photo visibility update)
- `DELETE /api/me/photos/:photoId` (my-page photo delete)
- `POST /api/inquiries` (public inquiry post)
- `GET /api/me/messages` (my-page inquiry history + templates)
- `GET /api/me/payments` (my-page payout summary + history)
- `PATCH /api/me/messages/:inquiryId` (my-page inquiry read/unread update)
- `POST /api/me/message-templates` (my-page template create)
- `PATCH /api/me/message-templates/:templateId` (my-page template update)
- `DELETE /api/me/message-templates/:templateId` (my-page template delete)
- `POST /api/tasks/:taskId/contact/allow` (AI opens channel after assignment)
- `GET /api/tasks/:taskId/contact/messages` (task contact messages)
- `POST /api/tasks/:taskId/contact/messages` (task contact send message; text and/or image attachment)
- `PATCH /api/tasks/:taskId/contact/read` (task contact mark read)
- `POST /api/webhooks` (AI webhook registration)
- `GET /api/webhooks?ai_account_id=...&ai_api_key=...` (AI webhook list)
- `POST /api/stripe/orders/:orderId/refund` (admin refund for Stripe order)

---

## Sample AI Tool Call (curl)

```bash
curl -X POST http://localhost:3000/api/call_human \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Take a photo of the nearest public park entrance",
    "ai_account_id": "uuid",
    "ai_api_key": "secret",
    "origin_country": "JP",
    "task_label": "real_world_verification",
    "acceptance_criteria": "Provide one clear photo of the park entrance sign.",
    "not_allowed": "Do not enter private property or include faces in close-up.",
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
  "status": "accepted"
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
open -> accepted -> review_pending -> completed
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
    "task_label": "real_world_verification",
    "acceptance_criteria": "Provide one clear photo of the park entrance sign.",
    "not_allowed": "Do not enter private property or include faces in close-up.",
    "ai_account_id": "uuid",
    "payer_paypal_email": "ai-ops@example.com",
    "payee_paypal_email": "worker@example.com",
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

## Task labels (required)

- `real_world_verification`: on-site checks, calls, physical confirmation
- `jp_local_research`: Japanese-language local info gathering
- `ai_output_qa`: final human QA of AI-generated output
- `bot_blocker_ops`: human steps where bots are blocked
- `lead_prep`: lead enrichment / pre-processing

## Service level

- Tasks are fulfilled on a `best effort` basis.
- No delivery-time/SLA guarantee is provided in MVP.

## Payment lifecycle (MVP)

- Default payout status is `pending`.
- Human submission changes task status to `review_pending`.
- `review_pending` has an auto-approval window (default 72h, clamped to 24-72h).
- If the requester does not respond within the window, the task is auto-approved (`completed`).
- AI requester finalizes completion by calling `POST /api/tasks/:taskId/approve` (`review_pending` -> `completed`).
- AI requester can reject by calling `POST /api/tasks/:taskId/reject` (`review_pending` -> `failed`, `failure_reason=requester_rejected`).
- `REVIEW_PENDING_AUTO_APPROVE_HOURS` can tune the window (minimum 24, maximum 72).
- Human dashboard `GET /api/me/payments` shows:
  - summary totals (`pending_total`, `approved_total`, `paid_total`)
  - per-task payout breakdown (`gross_amount`, `platform_fee`, `paypal_fee`, `net_amount`, `status`)

## Idempotency

- `POST /api/tasks` and `POST /api/call_human` accept `Idempotency-Key` header.
- Same key + same payload replays the previous response.
- Same key + different payload returns `idempotency_key_conflict`.

## Task Contact Attachments

- `POST /api/tasks/:taskId/contact/messages` accepts:
  - `application/json`: `{ "body": "...", "ai_account_id": "...", "ai_api_key": "..." }`
  - `multipart/form-data`: `body` (optional), `file` (optional image), and AI credentials fields when calling as AI.
  - When running automated user tests (dev only), you can also authenticate as the assigned human with:
    - `human_id` + `human_test_token` (see "Test Human Auth" below).
- At least one of `body` or `file` is required.
- Max text length is `4000` chars.
- Image attachment max size is `10MB`.
- Message objects include `attachment_url` (`null` when no image).

## Test Human Auth (Dev Only)

For automated "human-side" tests without NextAuth session cookies, the API supports a test-only auth mode.

Enable with environment variables:

```bash
ENABLE_TEST_HUMAN_AUTH=true
TEST_HUMAN_AUTH_SECRET=some-long-random-string
```

Generate `human_test_token` for a given `human_id`:

```bash
node -e "const crypto=require('crypto'); const secret=process.env.TEST_HUMAN_AUTH_SECRET; const humanId=process.argv[1]; console.log(crypto.createHmac('sha256', secret).update(humanId).digest('hex'))" "<HUMAN_ID>"
```

Supported endpoints (when enabled):

- `GET /api/tasks/:taskId/contact/messages?human_id=...&human_test_token=...`
- `POST /api/tasks/:taskId/contact/messages` with `human_id` + `human_test_token` in JSON or form-data
- `POST /api/submissions` with `human_id` + `human_test_token` in JSON or form-data

This auth mode must remain disabled in production.

## AI PayPal connect

Register once and use returned credentials in each tool call.

```json
POST /api/ai/accounts
{
  "name": "My Agent",
  "paypal_email": "ai-ops@example.com"
}
```

Response:

```json
{
  "status": "connected",
  "account_id": "uuid",
  "api_key": "secret"
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
- `requester_rejected`
- `missing_human`
- `not_found`
- `unknown`

---

## Human UI

- `/register` to register as a human
- `/ai/connect` to connect AI account PayPal and get API credentials
- `/tasks` to view and accept tasks (human ID is resolved from logged-in profile)
- `/tasks/:taskId` to submit deliverables
- `/profile/:humanId` to view public profile (public photos only)
- `/me` message tab to manage inquiry history and templates
- `country` is required on human registration (ISO2, e.g., `JP`).
- `paypal_email` is optional on human registration/profile (PayPal payout is not required).

---

## Storage

- SQLite database at `data/app.db`
- Uploaded files stored in `public/uploads`

---

## Payments (MVP)

- AI only supplies `budget_usd` and never directly executes payout.
- Minimum budget is `$5`.
- Stripe order lifecycle is tracked in `orders`.

## Stripe (Orders / Checkout)

This repo includes a Stripe Checkout-based payment flow for AI operators.

- `POST /api/stripe/orders` creates an `orders` row (AI-auth required).
- `POST /api/stripe/orders/:orderId/checkout` returns a `checkout_url` (AI-auth required).
- `POST /api/stripe/orders/:orderId/refund` executes admin refund on Stripe (admin-only).
- `POST /webhooks/stripe` receives verified Stripe events and stores them to DB quickly.
- `npm run stripe:webhook-worker` processes stored events and reconciles `orders`:
  - When an order becomes `paid`, it also updates the linked `tasks` row:
    - `paid_status='paid'`
    - `paid_at` set
    - `paid_method='stripe'`
  - If Stripe reports cancellation/failure/mismatch, it marks the linked task as:
    - `paid_status='failed'`
    - `payment_error_message` set

### Refund (admin)

- Refund API is admin-only (`ADMIN_EMAILS` allowlist + same-origin check).
- Request body:

```json
{
  "version": 1,
  "amount_minor": 500,
  "reason": "requested_by_customer"
}
```

- `amount_minor` omitted => full remaining refund.
- Accepted `reason`: `duplicate`, `fraudulent`, `requested_by_customer`.
- Order state tracks:
  - `refund_status` (`none`/`pending`/`partial`/`full`/`failed`)
  - `refund_amount_minor`
  - `refund_reason`
  - `refund_id`
  - `refunded_at`
  - `refund_error_message`

### Currency policy (JP/US only)

- Charges are created in the payee (human) currency:
  - `payee_country=JP` => `jpy`
  - `payee_country=US` => `usd`
- Amount fields are treated as minor units for the chosen currency.

### International surcharge

If `payer_country != payee_country`, an additional surcharge is added on top of the subtotal.
This surcharge is captured by the platform (included in `application_fee_amount`) to cover cross-border cost + risk buffer.

Env vars (optional, defaults exist):

- `INTL_SURCHARGE_BPS` (basis points, default `300` = 3.00%)
- `INTL_SURCHARGE_MIN_JPY` (default `100`)
- `INTL_SURCHARGE_MIN_USD_CENTS` (default `100`)

### Required env vars / ops

- `STRIPE_SECRET_KEY` (sk_...)
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` (used to validate checkout success/cancel redirect URLs)

Stripe dashboard:

- Set webhook endpoint to `/webhooks/stripe` and include the event types used by the worker:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `charge.succeeded`
  - `charge.failed`

---

## Run (local)

```bash
npm install
npm run dev
```
