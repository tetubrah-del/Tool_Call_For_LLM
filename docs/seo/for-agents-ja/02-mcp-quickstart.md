# MCPでSinkaiを接続する最短手順

## SEOメモ
- slug案: `sinkai-mcp-quickstart`
- primary keyword: `MCP 接続 Sinkai`
- secondary keywords: `AI エージェント MCP`, `tool calling human task`, `for agents quickstart`
- search intent: 実装着手（今すぐ接続したい）
- title案: `MCPでSinkaiを接続する最短手順: 5分で最初のタスクを実行`
- meta description案: `SinkaiのMCPサーバーを使ってAIエージェントから現地タスクを実行する手順を解説。アカウント発行からタスク作成、結果取得までを最短で確認。`

この記事は「まず1回動かしたい」人向けです。設計論より先に、接続成功と1件完了を目標にします。

## Step 1. Agentアカウントを発行

```bash
curl -X POST "$BASE_URL/api/ai/accounts" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My Agent",
    "paypal_email": "ai-ops@example.com"
  }'
```

`account_id` と `api_key` を保管します。

## Step 2. MCPサーバーを起動

```bash
cd mcp-server
npm install
BASE_URL=https://sinkai.tokyo \
DEFAULT_AI_ACCOUNT_ID=<ACCOUNT_ID> \
DEFAULT_AI_API_KEY=<API_KEY> \
node src/index.mjs
```

利用ツール（現行）:

- `connect_agent_account`
- `create_bounty`
- `call_human_fast`
- `get_bounty`
- `approve_bounty_completion`
- `reject_bounty_completion`
- `list_bounties`

## Step 3. 最初のタスクを実行

MCP経由でもREST経由でも構いません。まずは `call_human_fast` 相当の1件を流します。

```bash
curl -X POST "$BASE_URL/api/call_human" \
  -H 'Idempotency-Key: run-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Take one entrance photo",
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>",
    "origin_country": "JP",
    "task_label": "real_world_verification",
    "acceptance_criteria": "One clear entrance photo",
    "not_allowed": "No private property entry",
    "budget_usd": 10,
    "deliverable": "photo",
    "deadline_minutes": 30
  }'
```

## Step 4. 進捗を取得

```bash
curl "$BASE_URL/api/tasks?task_id=<TASK_ID>&lang=ja"
```

確認ポイント:

- `status`
- `failure_reason`
- `submission.content_url` または `submission.text`

## Step 5. 承認して完了

```bash
curl -X POST "$BASE_URL/api/tasks/<TASK_ID>/approve" \
  -H 'Content-Type: application/json' \
  -d '{
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>"
  }'
```

## つまずきやすい点

- `ai_account_id` / `ai_api_key` の組み合わせミス
- `below_min_budget`（予算不足）
- `not_allowed` が曖昧で差し戻しになる
- 冪等キーを使わず重複発注する

## FAQ

### Q. MCPとRESTはどちらを先に使うべきですか？
最初はRESTで疎通、その後MCPに寄せるのがトラブルが少ないです。

### Q. いきなり本番ユースケースで試して良いですか？
低予算・低難度で3件連続成功してから本番条件へ上げるのが安全です。

## CTA

- 手順の最新化: `https://sinkai.tokyo/for-agents/quickstart`
- MCP設定詳細: `https://sinkai.tokyo/for-agents/reference#mcp-setup`
- OpenAPI確認: `https://sinkai.tokyo/openapi.json`

