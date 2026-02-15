# Marketing Media 実装仕様（Seedance/Seedream）

この仕様は `/Users/tetubrah/Projects/Tool_Call_For_LLM` の既存構成（`lib/db.ts` の SQLite/Postgres 両対応）向けです。

## 1. TypeScript Provider I/F

実装ファイル:
- `/Users/tetubrah/Projects/Tool_Call_For_LLM/lib/marketing/media-providers.ts`

ポイント:
- `ImageProvider` / `VideoProvider` を分離
- `MediaProviderError` で `code` と `retryable` を統一
- 生成結果に `provider/model/prompt/seed/cost/latency/raw_response` を保持

## 2. DB Column 追加 SQL（Postgres）

前提: `marketing_contents` テーブルが存在すること。

```sql
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_provider TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_model TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_prompt TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_seed INTEGER;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_status TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_error_code TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_error_message TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_latency_ms INTEGER;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_cost_jpy INTEGER;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS generation_raw_response_json TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_asset_url TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_thumb_url TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_duration_sec REAL;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_width INTEGER;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_height INTEGER;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS media_mime_type TEXT;
ALTER TABLE marketing_contents ADD COLUMN IF NOT EXISTS updated_at TEXT;
```

生成ジョブ管理を分離する場合（推奨）:

```sql
CREATE TABLE IF NOT EXISTS marketing_generation_jobs (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  asset_type TEXT NOT NULL, -- image|video
  provider TEXT NOT NULL, -- seedream|seedance|fallback
  model TEXT NOT NULL,
  status TEXT NOT NULL, -- queued|processing|succeeded|failed
  prompt TEXT NOT NULL,
  prompt_negative TEXT,
  seed INTEGER,
  request_json TEXT,
  response_json TEXT,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  latency_ms INTEGER,
  cost_jpy INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS marketing_generation_jobs_status_next_attempt_idx
  ON marketing_generation_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS marketing_generation_jobs_content_idx
  ON marketing_generation_jobs (content_id, created_at);
```

## 3. DB 追加 SQL（SQLite）

SQLite は `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` が環境差で不安定なため、
`lib/db.ts` の `ensureSqliteColumn(...)` 方式を推奨。

`marketing_contents` 用追加カラム（`type`）:
- `generation_provider` `TEXT`
- `generation_model` `TEXT`
- `generation_prompt` `TEXT`
- `generation_seed` `INTEGER`
- `generation_status` `TEXT`
- `generation_error_code` `TEXT`
- `generation_error_message` `TEXT`
- `generation_latency_ms` `INTEGER`
- `generation_cost_jpy` `INTEGER`
- `generation_raw_response_json` `TEXT`
- `media_asset_url` `TEXT`
- `media_thumb_url` `TEXT`
- `media_duration_sec` `REAL`
- `media_width` `INTEGER`
- `media_height` `INTEGER`
- `media_mime_type` `TEXT`
- `updated_at` `TEXT`

`marketing_generation_jobs` を作る場合:

```sql
CREATE TABLE IF NOT EXISTS marketing_generation_jobs (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  prompt_negative TEXT,
  seed INTEGER,
  request_json TEXT,
  response_json TEXT,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  latency_ms INTEGER,
  cost_jpy INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS marketing_generation_jobs_status_next_attempt_idx
  ON marketing_generation_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS marketing_generation_jobs_content_idx
  ON marketing_generation_jobs (content_id, created_at);
```

## 4. Env 変数

- `SEEDREAM_API_KEY`
- `SEEDREAM_BASE_URL`
- `SEEDREAM_MODEL`
- `SEEDANCE_API_KEY`
- `SEEDANCE_BASE_URL`
- `SEEDANCE_MODEL`

## 5. 運用メモ

- X投稿は画像優先、TikTok投稿は「Seedream画像 -> Seedance動画化」をデフォルトにする。
- 生成失敗時は `fallback` provider へリトライ可能にする。
- `generation_raw_response_json` は障害調査用のため、PIIを含めないフィルタを通す。
