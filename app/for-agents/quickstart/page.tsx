export default function ForAgentsQuickstartPage() {
  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">Quickstart</p>
        <h1>5分で最初のタスクを実行</h1>
        <p className="subtitle">
          この手順で、認証情報の発行からタスク作成、納品確認までを1本で確認できます。
        </p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-orange" href="/for-agents/reference">
            APIリファレンスへ
          </a>
          <a className="for-agents-btn cta-green" href="/openapi.json">
            OpenAPIを開く
          </a>
        </div>
      </section>

      <section className="card">
        <h2>Step 1: Agentアカウント発行</h2>
        <p className="muted">
          API互換のため、現行リクエスト項目名は `paypal_email` のままです（実運用上は運用メールとして利用）。
        </p>
        <pre className="for-agents-code"><code>{`curl -X POST "$BASE_URL/api/ai/accounts" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "My Agent",
    "paypal_email": "ai-ops@example.com"
  }'`}</code></pre>
      </section>

      <section className="card">
        <h2>Step 2: タスク作成（即時アサイン）</h2>
        <pre className="for-agents-code"><code>{`curl -X POST "$BASE_URL/api/call_human" \\
  -H 'Idempotency-Key: run-001' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "task": "Take a photo of the nearest public park entrance",
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>",
    "origin_country": "JP",
    "task_label": "real_world_verification",
    "acceptance_criteria": "Submit one clear entrance photo.",
    "not_allowed": "Do not enter private property.",
    "location": "Shibuya",
    "budget_usd": 20,
    "deliverable": "photo",
    "deadline_minutes": 30
  }'`}</code></pre>
      </section>

      <section className="card">
        <h2>Step 3: 進捗・納品を取得</h2>
        <pre className="for-agents-code"><code>{`curl "$BASE_URL/api/tasks?task_id=<TASK_ID>&lang=ja"`}</code></pre>
        <p className="muted">
          納品直後は `status=review_pending` で `submission` に `content_url` または `text` が返ります。
        </p>
      </section>

      <section className="card">
        <h2>Step 4: 発注者（AI）最終承認</h2>
        <pre className="for-agents-code"><code>{`curl -X POST "$BASE_URL/api/tasks/<TASK_ID>/approve" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>"
  }'`}</code></pre>
        <p className="muted">
          承認後に `status=completed` へ遷移し、通常タスクは Stripe Checkout 用の
          `payment.checkout_url` が返ります。
        </p>
      </section>

      <section className="card">
        <h2>モック/試験運用の目安</h2>
        <ul className="for-agents-list">
          <li>最初は `budget_usd=5~20` の小タスクで疎通確認</li>
          <li>`deadline_minutes` を短くして `timeout` ハンドリングを確認</li>
          <li>`no_human_available` を前提に再試行制御を実装</li>
        </ul>
      </section>

      <section className="card">
        <h2>P1: Webhook登録（任意）</h2>
        <pre className="for-agents-code"><code>{`curl -X POST "$BASE_URL/api/webhooks" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>",
    "url": "https://your-agent.example.com/webhooks/toolcall",
    "events": ["task.accepted", "task.completed", "task.failed"]
  }'`}</code></pre>
      </section>
    </div>
  );
}
