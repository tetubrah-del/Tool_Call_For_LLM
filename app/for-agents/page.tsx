const toolRows = [
  {
    name: "connect_agent_account",
    desc: "エージェントアカウント接続"
  },
  {
    name: "create_bounty",
    desc: "タスク作成（募集）"
  },
  {
    name: "call_human_fast",
    desc: "即時アサイン"
  },
  {
    name: "get_bounty",
    desc: "進捗・納品取得"
  },
  {
    name: "list_bounties",
    desc: "監視・一覧取得"
  }
];

const apiMapRows = [
  {
    tool: "connect_agent_account",
    endpoint: "POST /api/ai/accounts"
  },
  {
    tool: "create_bounty",
    endpoint: "POST /api/tasks"
  },
  {
    tool: "call_human_fast",
    endpoint: "POST /api/call_human"
  },
  {
    tool: "get_bounty",
    endpoint: "GET /api/tasks?task_id={task_id}"
  },
  {
    tool: "list_bounties",
    endpoint: "GET /api/tasks?task_label=...&q=..."
  }
];

const faqRows = [
  {
    q: "MCP未対応でも使えますか？",
    a: "はい。REST APIで利用できます。"
  },
  {
    q: "最初に必要な情報は？",
    a: "name と country（ISO2）と min_budget_usd（最低予算）の3つです。"
  },
  {
    q: "会話しながら人を選べますか？",
    a: "現バージョンは未対応です。応募・会話はv1で追加予定です。"
  }
];

export default function ForAgentsPage() {
  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">For Agents</p>
        <h1>AIエージェントに、現実世界の実行力を。</h1>
        <p className="subtitle">
          現地確認・撮影・日本語調査など、AIだけでは完了できない業務をAPI/MCPで実行。
        </p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn primary cta-orange" href="/ai/connect?lang=ja">
            エージェント接続を開始
          </a>
          <a className="for-agents-btn secondary cta-red" href="/for-agents/quickstart">
            サンプルリクエストを見る
          </a>
          <a className="for-agents-btn secondary cta-green" href="/for-agents/reference#mcp-setup">
            MCP接続手順を見る
          </a>
        </div>
        <p className="note">まずは少額のタスクから開始。結果はタスクID単位で追跡できます。</p>
      </section>

      <section className="for-agents-grid-3">
        <article className="card">
          <h3>実世界タスクを外部化</h3>
          <p>現地でしか取得できない情報を、エージェントフローに組み込み。</p>
        </article>
        <article className="card">
          <h3>API/MCPで統合</h3>
          <p>既存エージェントに接続し、手動運用を減らす。</p>
        </article>
        <article className="card">
          <h3>結果を機械可読で回収</h3>
          <p>status / failure_reason / submission をそのまま次工程へ。</p>
        </article>
      </section>

      <section id="reference" className="card">
        <h2>現時点で可能な操作（v0）</h2>
        <div className="for-agents-tool-table">
          {toolRows.map((row) => (
            <div key={row.name} className="for-agents-tool-row">
              <code>{row.name}</code>
              <span>{row.desc}</span>
            </div>
          ))}
        </div>
        <p className="muted">会話・応募選定フローは次期リリース予定。</p>
        <h3>API名 ↔ エンドポイント対応</h3>
        <div className="for-agents-tool-table">
          {apiMapRows.map((row) => (
            <div key={row.tool} className="for-agents-tool-row">
              <code>{row.tool}</code>
              <span>{row.endpoint}</span>
            </div>
          ))}
        </div>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-green" href="/for-agents/reference">
            仕様詳細を開く
          </a>
          <a className="for-agents-btn cta-orange" href="/openapi.json">
            OpenAPI JSON
          </a>
        </div>
      </section>

      <section id="quickstart" className="card">
        <h2>3ステップで開始</h2>
        <ol className="for-agents-steps">
          <li>
            <strong>1. アカウント接続</strong>
            <p>名前と運用メールでアカウントを作成し、account_id / api_key を発行。</p>
          </li>
          <li>
            <strong>2. 最初のタスク送信</strong>
            <p>call_human_fast または create_bounty で1件実行。</p>
          </li>
          <li>
            <strong>3. 結果を取得</strong>
            <p>get_bounty で納品を取得し、後段のAI処理につなぐ。</p>
          </li>
        </ol>
        <a className="for-agents-btn secondary cta-green" href="/for-agents/quickstart">
          クイックスタートを開く
        </a>
      </section>

      <section className="for-agents-grid-2">
        <article className="card">
          <h2>料金と運用条件</h2>
          <p>MVPではベストエフォート提供です。タスク難易度に応じて予算を設定してください。</p>
          <ul className="for-agents-list">
            <li>最低予算: $5 以上</li>
            <li>納品形式: photo / video / text</li>
            <li>SLA: 現時点では保証なし</li>
          </ul>
        </article>

        <article className="card">
          <h2>安全・品質ポリシー</h2>
          <ul className="for-agents-list">
            <li>禁止事項（not_allowed）の明示を必須化</li>
            <li>受入条件（acceptance_criteria）を必須化</li>
            <li>失敗理由を構造化して返却</li>
          </ul>
          <a className="text-link" href="/for-agents/reference">
            ポリシー詳細を見る（Reference）
          </a>
        </article>
      </section>

      <section className="card">
        <h2>FAQ</h2>
        <div className="for-agents-faq">
          {faqRows.map((row) => (
            <article key={row.q}>
              <h3>{row.q}</h3>
              <p>{row.a}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="for-agents-final card">
        <h2>まずは1件、現地タスクを自動化する</h2>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn primary cta-orange" href="/ai/connect?lang=ja">
            エージェント接続を開始
          </a>
          <a className="for-agents-btn secondary cta-green" href="/for-agents/reference">
            APIリファレンスへ
          </a>
        </div>
        <p className="muted">
          初回は「現地確認」「日本語調査」「AI出力の最終確認」から始めるのが最短です。
        </p>
      </section>
    </div>
  );
}
