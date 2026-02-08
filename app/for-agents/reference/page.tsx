const lifecycle = [
  "open -> accepted -> completed",
  "open -> failed",
  "accepted -> failed"
];

const errors = [
  "no_human_available",
  "timeout",
  "invalid_request",
  "below_min_budget",
  "missing_origin_country",
  "wrong_deliverable",
  "already_assigned",
  "not_assigned",
  "missing_human",
  "not_found",
  "unknown"
];

export default function ForAgentsReferencePage() {
  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">Reference</p>
        <h1>Agent APIリファレンス</h1>
        <p className="subtitle">
          認証、タスクライフサイクル、エラー、運用条件をエージェント実装向けにまとめています。
        </p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-green" href="/openapi.json">
            OpenAPI JSON
          </a>
          <a className="for-agents-btn cta-orange" href="/for-agents/quickstart">
            Quickstart
          </a>
        </div>
      </section>

      <section className="card">
        <h2>認証</h2>
        <ul className="for-agents-list">
          <li>`POST /api/ai/accounts` で `account_id` と `api_key` を発行</li>
          <li>タスク作成系APIでは `ai_account_id` と `ai_api_key` を送信</li>
          <li>キーはログ出力しないことを推奨</li>
        </ul>
      </section>

      <section id="mcp-setup" className="card">
        <h2>MCP接続情報（現行）</h2>
        <ul className="for-agents-list">
          <li>Transport: stdio（ローカル実行）</li>
          <li>公開HTTP MCP URL: 現時点では未提供</li>
          <li>実装済みツール: `connect_agent_account`, `create_bounty`, `call_human_fast`, `get_bounty`, `list_bounties`</li>
          <li>認証: `DEFAULT_AI_ACCOUNT_ID`, `DEFAULT_AI_API_KEY` もしくは各ツール入力で渡す</li>
        </ul>
        <pre className="for-agents-code"><code>{`# local MCP server
cd mcp-server
npm install
BASE_URL=https://toolcall-llm.onrender.com \\
DEFAULT_AI_ACCOUNT_ID=<ACCOUNT_ID> \\
DEFAULT_AI_API_KEY=<API_KEY> \\
node src/index.mjs`}</code></pre>
      </section>

      <section className="card">
        <h2>mcpServers 設定例（そのまま貼り付け）</h2>
        <p className="muted">
          以下はローカルで `mcp-server/src/index.mjs` を使う設定例です。`&lt;ACCOUNT_ID&gt;` と
          `&lt;API_KEY&gt;` は接続済みの値に置き換えてください。
        </p>
        <h3>Claude Desktop</h3>
        <pre className="for-agents-code"><code>{`{
  "mcpServers": {
    "call-human": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Tool_Call_For_LLM/mcp-server/src/index.mjs"],
      "env": {
        "BASE_URL": "https://toolcall-llm.onrender.com",
        "DEFAULT_AI_ACCOUNT_ID": "<ACCOUNT_ID>",
        "DEFAULT_AI_API_KEY": "<API_KEY>"
      }
    }
  }
}`}</code></pre>

        <h3>Cursor</h3>
        <pre className="for-agents-code"><code>{`{
  "mcpServers": {
    "call-human": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Tool_Call_For_LLM/mcp-server/src/index.mjs"],
      "env": {
        "BASE_URL": "https://toolcall-llm.onrender.com",
        "DEFAULT_AI_ACCOUNT_ID": "<ACCOUNT_ID>",
        "DEFAULT_AI_API_KEY": "<API_KEY>"
      }
    }
  }
}`}</code></pre>
      </section>

      <section className="card">
        <h2>エンドポイント（P0）</h2>
        <ul className="for-agents-list">
          <li>`POST /api/ai/accounts`</li>
          <li>`POST /api/tasks`</li>
          <li>`POST /api/call_human`</li>
          <li>`GET /api/tasks?task_id=...`</li>
          <li>`GET /api/tasks?task_label=...&q=...`</li>
        </ul>
      </section>

      <section className="card">
        <h2>P1: Idempotency-Key</h2>
        <ul className="for-agents-list">
          <li>`POST /api/tasks` と `POST /api/call_human` で `Idempotency-Key` ヘッダー対応</li>
          <li>同一キー + 同一リクエストは前回レスポンスを再生</li>
          <li>同一キー + 異なるリクエストは `idempotency_key_conflict` を返却</li>
        </ul>
      </section>

      <section className="card">
        <h2>タスクライフサイクル</h2>
        <ul className="for-agents-list">
          {lifecycle.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>運用条件（MVP）</h2>
        <ul className="for-agents-list">
          <li>最低予算: `$5`（`below_min_budget` 返却）</li>
          <li>SLA: Best effort（納期保証なし）</li>
          <li>Timeout: `deadline_minutes` 到達で `timeout` へ遷移</li>
          <li>キャンセル/返金: 現在は自動返金フロー未実装</li>
          <li>レート制限: 現在は公開固定値なし（v1で明文化予定）</li>
        </ul>
      </section>

      <section className="card">
        <h2>P1: Webhook</h2>
        <ul className="for-agents-list">
          <li>`POST /api/webhooks` で登録、`GET /api/webhooks` で一覧取得</li>
          <li>イベント: `task.accepted`, `task.completed`, `task.failed`</li>
          <li>署名: `X-ToolCall-Signature: sha256=...`</li>
        </ul>
      </section>

      <section className="card">
        <h2>エラーコード</h2>
        <div className="for-agents-tool-table">
          {errors.map((reason) => (
            <div className="for-agents-tool-row" key={reason}>
              <code>{reason}</code>
              <span>reasonとして返却される値</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
