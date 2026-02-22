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
- `GET /api/tasks/:taskId/reviews` (task review visibility and own/counterparty review)
- `POST /api/tasks/:taskId/reviews` (submit/update task review; editable until published)
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
- `GET /api/me/reviews/summary` (my-page rating summary)
- `GET /api/me/notifications` (human notification settings)
- `PATCH /api/me/notifications` (update human notification settings)
- `GET /api/ai/reviews/summary?ai_account_id=...&ai_api_key=...` (AI rating summary)
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

## Review lifecycle (MVP)

- Review target is `completed` tasks only.
- Review window closes 7 days after completion (`review_deadline_at`).
- A submitted review can be edited until it is published.
- Counterparty review is hidden until both sides submit or the review window closes.
- At publish time, both reviews become visible together (or only the submitted one after deadline).

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

## Human Dashboard API入口（先行リリース）

- `/me` のタブに `APIキー` 入口を追加済み（`プロフィール / 支払い / メッセージ / APIキー` の順）。
- `Human APIキー` の作成 / ローテーション / 失効を `APIキー` タブと `/api/me/api-keys` で管理可能。
- 月間上限は `human` ごとに固定値（初期値 `1000`）で、`JST` 月次リセット。
- 使用量は `/api/me/api-usage` で取得可能。残量が 5% / 1% を下回ると警告対象。

## Human API Key (MVP)

- 認証ヘッダー:
  - `Authorization: Bearer <human_api_key>`（推奨）
  - `X-Human-Api-Key: <human_api_key>`（互換）
- 対象スコープ:
  - `messages:read`, `messages:write`, `submissions:write`, `payments:read`, `profile:read`
- 上限超過時:
  - `429` + `reason=monthly_limit_exceeded`
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - `X-Usage-Warn`（低残量警告）

## Email notifications (Human, MVP)

- Triggered events:
  - Task application accepted (`open -> accepted`)
  - New AI message in task contact channel (`sender_type=ai`)
- User can configure in `/me` notifications tab:
  - `email_enabled`
  - `notify_task_accepted`
  - `notify_ai_message`
- Delivery is async via DB queue (`email_deliveries`) and worker:
  - Run once: `npm run notifications:worker`
  - Continuous mode: `EMAIL_WORKER_CONTINUOUS=true npm run notifications:worker`
- Required environment variables for sending:
  - `RESEND_API_KEY`
  - `NOTIFICATION_FROM_EMAIL`
  - Optional app links base URL: `APP_BASE_URL` (fallback: `NEXTAUTH_URL`, then `http://localhost:3000`)

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

## Assignment concurrency

- Human workers can accept multiple tasks concurrently.
- Matching does not use `humans.status` (`available`/`busy`) as an assignment gate.
- `no_human_available` is returned only when no eligible human exists after non-status filters (for example `deleted_at`, optional location match).

## Payment lifecycle (MVP)

- Default payout status is `pending`.
- Human submission changes task status to `review_pending`.
- `review_pending` has an auto-approval window (default 72h, clamped to 24-72h).
- If the requester does not respond within the window, the task is auto-approved (`completed`) only after payment capture succeeds (legacy tasks without order/auth data are backward-compatible).
- AI requester finalizes completion by calling `POST /api/tasks/:taskId/approve` (`review_pending` -> `completed`).
  - This captures the pre-authorized Stripe PaymentIntent and settles the task payment.
  - Response includes `payment.status=captured` and `payment_intent_id` on success.
- AI requester can reject by calling `POST /api/tasks/:taskId/reject` (`review_pending` -> `failed`, `failure_reason=requester_rejected`).
- `REVIEW_PENDING_AUTO_APPROVE_HOURS` can tune the window (minimum 24, maximum 72).
- Human dashboard `GET /api/me/payments` shows:
  - summary totals (`pending_total`, `approved_total`, `paid_total`)
  - per-task payout breakdown (`gross_amount`, `platform_fee`, `paypal_fee`, `net_amount`, `status`)

## Idempotency

- `POST /api/tasks` and `POST /api/call_human` accept `Idempotency-Key` header.
- Same key + same payload replays the previous response.
- Same key + different payload returns `idempotency_key_conflict`.

## AI API Rate Limits (MVP)

- AI account authentication paths enforce fixed limits by default:
  - Monthly: `50000` requests per `ai_account_id`
  - Burst: `60` requests per minute per `ai_account_id`
- Over-limit responses:
  - `429` + `reason=monthly_limit_exceeded`
  - `429` + `reason=minute_limit_exceeded`
- Response headers include:
  - `X-AI-RateLimit-Limit-Month`, `X-AI-RateLimit-Remaining-Month`, `X-AI-RateLimit-Reset-Month`
  - `X-AI-RateLimit-Limit-Minute`, `X-AI-RateLimit-Remaining-Minute`, `X-AI-RateLimit-Reset-Minute`
  - `X-AI-Usage-Warn` (and `X-AI-Usage-Warn-Threshold` at >= 80% / 95%)
- Ops override:
  - `AI_API_LIMIT_BYPASS_IDS` (comma-separated `ai_account_id`) bypasses limits for allowlisted accounts.

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

## Stripe (Orders / Authorization / Capture)

This repo uses a pre-authorization + capture flow for AI operator payments.

- `POST /api/stripe/orders` creates an `orders` row (AI-auth required).
- `POST /api/ai/billing/setup-intent` creates a SetupIntent for card registration (AI-auth required).
- `POST /api/ai/billing/payment-method` attaches and sets default payment method (AI-auth required).
- `POST /api/call_human` and `POST /api/tasks/:taskId/accept` authorize payment (`capture_method=manual`) before assignment is finalized.
- `POST /api/tasks/:taskId/approve` captures the authorization and marks task payment as paid.
- `POST /api/stripe/orders/:orderId/checkout` remains available for legacy/manual Checkout flow.
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
- Task create APIs support quote inputs:
  - `currency` (`jpy`/`usd`)
  - `amount_minor` (minor unit)
  - Backward compatibility: `budget_usd` is still accepted.

### International surcharge

If `payer_country != payee_country`, an additional surcharge is added on top of the subtotal.
This surcharge is captured by the platform (included in `application_fee_amount`) to cover cross-border cost + risk buffer.

Env vars (optional, defaults exist):

- `INTL_SURCHARGE_BPS` (basis points, default `300` = 3.00%)
- `INTL_SURCHARGE_MIN_JPY` (default `100`)
- `INTL_SURCHARGE_MIN_USD_CENTS` (default `100`)

### Required env vars / ops

- `STRIPE_SECRET_KEY` (sk_...)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_..., required for AI card registration UI on `/ai/connect`)
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` (used to validate checkout success/cancel redirect URLs)

### Optional object storage (Cloudflare R2)

When set, uploads (submission attachments / message attachments / profile photos) are stored in R2 instead of local `public/uploads`.

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- Optional: `R2_ENDPOINT` (default: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
- Optional: `R2_KEY_PREFIX` (default: `uploads`)

Uploaded files are returned as app URLs: `/api/storage/<object-key>`.

### Optional marketing generation API (isolated)

Marketing job APIs are isolated from core Sinkai task/payment flows and require a separate API key.

- `POST /api/marketing/jobs` enqueue generation job
- `GET /api/marketing/jobs?job_id=<JOB_ID>` get job status
- `GET /api/marketing/jobs/<JOB_ID>` get job + related content status
- `POST /api/marketing/contents` create publishable content (returns `content.id`)
- `POST /api/marketing/ingest` ingest Amazon.co.jp product URL via PA-API and auto-enqueue video generation
- `GET /api/marketing/contents?content_id=<CONTENT_ID>` get one content
- `POST /api/marketing/publish` enqueue publish job
- `GET /api/marketing/publish?job_id=<JOB_ID>` get publish job status
- `GET /api/marketing/publish/<JOB_ID>` get publish job + related content/post status

`POST /api/marketing/contents` supports optional source metadata for news-driven workflows:

- direct fields: `source_type`, `source_url`, `source_post_id`, `source_title`, `source_publisher`, `source_domain`, `source_published_at`, `product_url`
- or structured object: `source_context` / `source_context_json`
- publish behavior on X:
  - `source_type=x_post` + `source_post_id` -> native quote post (`quote_tweet_id`)
  - non-X sources (RSS/blog/news) -> source URL appended to post text when missing

Required env for API auth:

- `MARKETING_API_KEY`

Worker safety flags (default OFF):

- `MARKETING_GENERATION_WORKER_ENABLED=true` to enable worker process
- `MARKETING_GENERATION_PLACEHOLDER_EXECUTE=true` to execute provider calls (second safety gate)
- `MARKETING_PUBLISH_WORKER_ENABLED=true` to enable publish worker process
- `MARKETING_PUBLISH_PLACEHOLDER_EXECUTE=true` to execute publish provider calls (second safety gate)

Provider env (required for execution):

- `SEEDREAM_API_KEY`, `SEEDREAM_BASE_URL`, `SEEDREAM_MODEL` (image)
- `SEEDANCE_API_KEY`, `SEEDANCE_BASE_URL`, `SEEDANCE_MODEL` (video)
- Grok idea source for SEO/X copy generation in `/api/marketing/ingest` (optional, auto-fallback when missing):
  - `XAI_API_KEY`
  - Optional: `XAI_BASE_URL` (default `https://api.x.ai/v1`)
  - Optional: `XAI_MODEL` (default `grok-3-mini`)
  - Optional: `XAI_TIMEOUT_MS` (default `20000`)
- Amazon Creators API (required for `/api/marketing/ingest`):
  - `CREATORS_API_CREDENTIAL_ID`
  - `CREATORS_API_CREDENTIAL_SECRET`
  - `CREATORS_API_CREDENTIAL_VERSION` (example: FE region `2.3`)
  - `CREATORS_API_PARTNER_TAG`
  - `CREATORS_API_MARKETPLACE` (default `www.amazon.co.jp`)
  - Optional: `CREATORS_API_BASE_URL`, `CREATORS_API_AUTH_ENDPOINT`
  - Backward-compat fallback env names are also accepted (`AMAZON_CREATORS_*` and existing `AMAZON_PAAPI_*`)

Optional worker tuning:

- `MARKETING_GENERATION_WORKER_CONTINUOUS=true`
- `MARKETING_GENERATION_WORKER_POLL_MS` (default `15000`)
- `MARKETING_GENERATION_WORKER_BATCH_SIZE` (default `10`)
- `MARKETING_GENERATION_MAX_ATTEMPTS` (default `5`)
- `SEEDREAM_IMAGE_ENDPOINT` (default `/images/generations`)
- `SEEDANCE_VIDEO_ENDPOINT` (default `/contents/generations/tasks`)
- `SEEDANCE_TASK_GET_ENDPOINT` (default `/contents/generations/tasks/{task_id}`)
- `SEEDANCE_TASK_POLL_MS` (default `4000`)
- `SEEDANCE_TASK_MAX_WAIT_MS` (default `300000`)
- `SEEDREAM_TIMEOUT_MS` (default `60000`)
- `SEEDANCE_TIMEOUT_MS` (default `120000`)
- `MARKETING_PUBLISH_WORKER_CONTINUOUS=true`
- `MARKETING_PUBLISH_WORKER_POLL_MS` (default `15000`)
- `MARKETING_PUBLISH_WORKER_BATCH_SIZE` (default `10`)
- `MARKETING_PUBLISH_MAX_ATTEMPTS` (default `5`)
- Autonomous posting + identity adaptation worker:
  - `MARKETING_AUTONOMOUS_WORKER_ENABLED=true`
  - `MARKETING_AUTONOMOUS_PLACEHOLDER_EXECUTE=true`
  - `MARKETING_AUTONOMOUS_WORKER_CONTINUOUS=true`
  - `MARKETING_AUTONOMOUS_WORKER_POLL_MS` (default `300000`)
  - `MARKETING_AUTONOMOUS_DAILY_POST_LIMIT` (default `3`)
  - `MARKETING_AUTONOMOUS_MIN_INTERVAL_MINUTES` (default `120`)
  - `MARKETING_AUTONOMOUS_TIMEZONE` (default `Asia/Tokyo`)
  - `MARKETING_AUTONOMOUS_ACTIVE_HOUR_START` (default `8`)
  - `MARKETING_AUTONOMOUS_ACTIVE_HOUR_END` (default `23`, exclusive)
  - `MARKETING_AUTONOMOUS_MIX_INTERNATIONAL_QUOTE` (default `4`)
  - `MARKETING_AUTONOMOUS_MIX_DOMESTIC_QUOTE` (default `2`)
  - `MARKETING_AUTONOMOUS_MIX_ORIGINAL` (default `2`)
  - `MARKETING_AUTONOMOUS_INTERNATIONAL_QUOTE_ACCOUNTS` (comma-separated X handles, default `OpenAI,AnthropicAI,GoogleDeepMind,MistralAI,huggingface,AIatMeta,NVIDIAAI`)
  - `MARKETING_AUTONOMOUS_DOMESTIC_QUOTE_ACCOUNTS` (comma-separated X handles, default `masahirochaen`)
  - `MARKETING_AUTONOMOUS_IDENTITY_ID` (default `koyuki`)
  - `MARKETING_AUTONOMOUS_DISPLAY_NAME` (default `小雪`)
  - `MARKETING_AUTONOMOUS_TOPICS` (comma-separated topics)
  - `MARKETING_AUTONOMOUS_BASE_HASHTAGS` (comma-separated hashtags)
- `MARKETING_AUTONOMOUS_METRICS_FETCH_LIMIT` (default `20`)
- `MARKETING_AUTONOMOUS_REQUIRE_X_AUTH` (default `true`)
- Autonomous drafting source + pre-post checks:
  - `MARKETING_AUTONOMOUS_LLM_ENABLED` (default `true`)
  - `MARKETING_AUTONOMOUS_GENERATOR` (default `openclaw`; options: `openclaw`, `api`)
  - OpenClaw generator (API key not required; uses paired gateway session):
    - `MARKETING_AUTONOMOUS_OPENCLAW_BIN` (default `openclaw`)
    - `MARKETING_AUTONOMOUS_OPENCLAW_AGENT_ID` (default `main`)
    - `MARKETING_AUTONOMOUS_OPENCLAW_SESSION_ID` (default `autonomous-koyuki-x`)
    - `MARKETING_AUTONOMOUS_OPENCLAW_THINKING` (default `low`)
    - `MARKETING_AUTONOMOUS_OPENCLAW_TIMEOUT_SECONDS` (default `180`)
  - API LLM generator (when `MARKETING_AUTONOMOUS_GENERATOR=api`):
    - `MARKETING_AUTONOMOUS_LLM_PROVIDER` (default `xai`; `openai` also supported)
    - `MARKETING_AUTONOMOUS_LLM_BASE_URL` (default provider specific)
    - `MARKETING_AUTONOMOUS_LLM_MODEL` (default provider specific)
    - `MARKETING_AUTONOMOUS_LLM_API_KEY` (if unset, falls back to `XAI_API_KEY` or `OPENAI_API_KEY`)
    - `MARKETING_AUTONOMOUS_LLM_TIMEOUT_MS` (default `30000`)
  - `MARKETING_AUTONOMOUS_LLM_MAX_ATTEMPTS` (default `3`)
  - `MARKETING_AUTONOMOUS_LLM_FALLBACK_TEMPLATE` (default `true`; set `false` to hard-require AI drafts)
  - `MARKETING_AUTONOMOUS_POST_CHECK_MIN_SCORE` (default `70`)
  - `MARKETING_AUTONOMOUS_POST_MIN_CHARS` (default `90`)
  - `MARKETING_AUTONOMOUS_POST_MAX_CHARS` (default `220`)
  - `MARKETING_AUTONOMOUS_POST_MAX_HASHTAGS` (default `2`)
  - `MARKETING_AUTONOMOUS_POST_MAX_EMOJIS` (default `2`)
  - `MARKETING_AUTONOMOUS_POST_TONE_POLICY` (default `strict`; `balanced` or `free` to allow more colloquial tone)
  - OpenClaw/API generator can optionally return `source_context`; when `source_type=x_post` + `source_post_id` the publish worker posts as native quote, otherwise it appends `source_url` for non-X sources
- `MARKETING_ALERT_EMAIL` (default `tetubrah@gmail.com`; notified on extract/generate/publish terminal failures)

X publisher env (minimal):

- OAuth 1.0a (recommended for single bot account):
  - `MARKETING_X_API_KEY`
  - `MARKETING_X_API_SECRET`
  - `MARKETING_X_USER_ACCESS_TOKEN`
  - `MARKETING_X_USER_ACCESS_TOKEN_SECRET`
- OAuth 2.0 bearer (alternative):
  - `MARKETING_X_USER_ACCESS_TOKEN`
- `MARKETING_X_POSTS_BASE_URL` (default `https://api.x.com`)
- `MARKETING_X_MEDIA_UPLOAD_BASE_URL` (default `https://upload.twitter.com`)
- `MARKETING_X_TIMEOUT_MS` (default `30000`)
- `MARKETING_X_MEDIA_CHUNK_SIZE` (default `4194304`)
- `MARKETING_X_MEDIA_PROCESSING_TIMEOUT_MS` (default `300000`)
- Long-form handling:
  - `MARKETING_X_LONGFORM_STRATEGY` (default `auto`)
    - `auto`: try single post with full text; if rejected, fallback to thread
    - `single`: only single post (no thread fallback)
    - `thread`: force thread for long text
    - `truncate`: legacy behavior (clip to short limit)
  - `MARKETING_X_SHORT_TEXT_LIMIT` (default `280`)
  - `MARKETING_X_THREAD_CHUNK_SIZE` (default `260`)

Note:

- Direct video attachment to X uses chunked media upload and requires OAuth 1.0a user context keys.
- With OAuth 2.0 bearer-only setup, text/link posting still works, but media upload is not attempted.
- `/api/marketing/ingest` enforces duplicate guard for same `product_url` within 24 hours.
- Generation success auto-enqueues publish job for channel `x`.
- `marketing:autonomous-worker` updates a persisted identity profile from recent X reaction metrics
  (`marketing_metrics_daily`) and auto-enqueues text posts while respecting daily limit and interval.

Seedance/ModelArk note:

- `SEEDANCE_BASE_URL` should point to ModelArk runtime host (for example `https://ark.ap-southeast.bytepluses.com/api/v3`).
- If you set `ark.<region>.byteplusapi.com`, worker normalizes it to the runtime host/path.

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
