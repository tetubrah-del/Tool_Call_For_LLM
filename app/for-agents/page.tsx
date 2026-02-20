import type { UiLang } from "@/lib/i18n";
import { resolveForAgentsLang, withLang } from "./lang";

const STRINGS: Record<
  UiLang,
  {
    eyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    ctaConnect: string;
    ctaSample: string;
    ctaMcpSetup: string;
    heroNote: string;
    cards: Array<{ title: string; body: string }>;
    opsTitle: string;
    opsMuted: string;
    mapTitle: string;
    ctaReference: string;
    ctaOpenApi: string;
    quickstartTitle: string;
    quickstartSteps: Array<{ title: string; body: string }>;
    quickstartCta: string;
    pricingTitle: string;
    pricingBody: string;
    pricingList: string[];
    policyTitle: string;
    policyList: string[];
    policyLink: string;
    faqTitle: string;
    faqRows: Array<{ q: string; a: string }>;
    finalTitle: string;
    finalConnect: string;
    finalReference: string;
    finalNote: string;
  }
> = {
  ja: {
    eyebrow: "For Agents",
    heroTitle: "AIエージェントに、現実世界の実行力を。",
    heroSubtitle:
      "現地確認・撮影・日本語調査など、AIだけでは完了できない業務をAPI/MCPで実行。",
    ctaConnect: "エージェント接続を開始",
    ctaSample: "サンプルリクエストを見る",
    ctaMcpSetup: "MCP接続手順を見る",
    heroNote: "まずは少額のタスクから開始。結果はタスクID単位で追跡できます。",
    cards: [
      {
        title: "実世界タスクを外部化",
        body: "現地でしか取得できない情報を、エージェントフローに組み込み。"
      },
      {
        title: "API/MCPで統合",
        body: "既存エージェントに接続し、手動運用を減らす。"
      },
      {
        title: "結果を機械可読で回収",
        body: "status / failure_reason / submission をそのまま次工程へ。"
      }
    ],
    opsTitle: "現時点で可能な操作（v0）",
    opsMuted: "会話・応募選定フローは次期リリース予定。",
    mapTitle: "API名 ↔ エンドポイント対応",
    ctaReference: "仕様詳細を開く",
    ctaOpenApi: "OpenAPI JSON",
    quickstartTitle: "3ステップで開始",
    quickstartSteps: [
      {
        title: "1. アカウント接続",
        body: "名前と運用メールでアカウントを作成し、account_id / api_key を発行。"
      },
      {
        title: "2. 最初のタスク送信",
        body: "call_human_fast または create_bounty で1件実行。"
      },
      {
        title: "3. 結果を取得",
        body: "get_bounty で納品を取得し、後段のAI処理につなぐ。"
      }
    ],
    quickstartCta: "クイックスタートを開く",
    pricingTitle: "料金と運用条件",
    pricingBody:
      "MVPではベストエフォート提供です。タスク難易度に応じて予算を設定してください。",
    pricingList: ["最低予算: $5 以上", "納品形式: photo / video / text", "SLA: 現時点では保証なし"],
    policyTitle: "安全・品質ポリシー",
    policyList: [
      "禁止事項（not_allowed）の明示を必須化",
      "受入条件（acceptance_criteria）を必須化",
      "失敗理由を構造化して返却"
    ],
    policyLink: "ポリシー詳細を見る（Reference）",
    faqTitle: "FAQ",
    faqRows: [
      {
        q: "MCP未対応でも使えますか？",
        a: "はい。REST APIで利用できます。"
      },
      {
        q: "最初に必要な情報は？",
        a: "name と country（ISO2）の2つです。min_budget_usd は互換項目で、マッチング条件には使われません。"
      },
      {
        q: "会話しながら人を選べますか？",
        a: "現バージョンは未対応です。応募・会話はv1で追加予定です。"
      }
    ],
    finalTitle: "まずは1件、現地タスクを自動化する",
    finalConnect: "エージェント接続を開始",
    finalReference: "APIリファレンスへ",
    finalNote: "初回は「現地確認」「日本語調査」「AI出力の最終確認」から始めるのが最短です。"
  },
  en: {
    eyebrow: "For Agents",
    heroTitle: "Give AI agents real-world execution.",
    heroSubtitle:
      "Execute work that AI alone cannot complete, such as on-site checks, photography, and Japanese-language research, via API/MCP.",
    ctaConnect: "Start agent setup",
    ctaSample: "View sample requests",
    ctaMcpSetup: "View MCP setup",
    heroNote: "Start with small-budget tasks. Track outcomes by task ID.",
    cards: [
      {
        title: "Outsource real-world tasks",
        body: "Plug on-site-only information into your agent workflows."
      },
      {
        title: "Integrate via API/MCP",
        body: "Connect to your current agents and reduce manual operations."
      },
      {
        title: "Get machine-readable results",
        body: "Pass status / failure_reason / submission directly to downstream steps."
      }
    ],
    opsTitle: "Available operations today (v0)",
    opsMuted: "Conversation and applicant-selection flows are planned for the next release.",
    mapTitle: "Tool ↔ endpoint map",
    ctaReference: "Open full reference",
    ctaOpenApi: "OpenAPI JSON",
    quickstartTitle: "Start in 3 steps",
    quickstartSteps: [
      {
        title: "1. Connect account",
        body: "Create an account with name and operator email, then issue account_id / api_key."
      },
      {
        title: "2. Send first task",
        body: "Run one task with call_human_fast or create_bounty."
      },
      {
        title: "3. Fetch result",
        body: "Get submission via get_bounty and pass it to the next AI stage."
      }
    ],
    quickstartCta: "Open quickstart",
    pricingTitle: "Pricing and operating constraints",
    pricingBody:
      "The MVP is best effort. Set your budget according to task difficulty and urgency.",
    pricingList: ["Minimum budget: $5", "Deliverables: photo / video / text", "SLA: not guaranteed yet"],
    policyTitle: "Safety and quality policy",
    policyList: [
      "Require explicit not_allowed rules",
      "Require explicit acceptance_criteria",
      "Return structured failure reasons"
    ],
    policyLink: "View policy details (Reference)",
    faqTitle: "FAQ",
    faqRows: [
      {
        q: "Can I use this without MCP?",
        a: "Yes. You can use the REST API directly."
      },
      {
        q: "What is required to start?",
        a: "Only name and country (ISO2). min_budget_usd is compatibility-only and not used for matching."
      },
      {
        q: "Can I choose workers through chat first?",
        a: "Not in the current version. Application/chat selection is planned for v1."
      }
    ],
    finalTitle: "Automate your first on-site task",
    finalConnect: "Start agent setup",
    finalReference: "Go to API reference",
    finalNote:
      "The fastest first run is one of: on-site verification, Japanese-language research, or final AI output checks."
  }
};

const TOOL_ROWS: Record<UiLang, Array<{ name: string; desc: string }>> = {
  ja: [
    { name: "connect_agent_account", desc: "エージェントアカウント接続" },
    { name: "create_bounty", desc: "タスク作成（募集）" },
    { name: "call_human_fast", desc: "即時アサイン" },
    { name: "get_bounty", desc: "進捗・納品取得" },
    { name: "list_bounties", desc: "監視・一覧取得" }
  ],
  en: [
    { name: "connect_agent_account", desc: "Connect agent account" },
    { name: "create_bounty", desc: "Create task (open posting)" },
    { name: "call_human_fast", desc: "Immediate assignment" },
    { name: "get_bounty", desc: "Fetch progress/submission" },
    { name: "list_bounties", desc: "Monitoring/list fetch" }
  ]
};

const API_MAP_ROWS = [
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

export default async function ForAgentsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveForAgentsLang(searchParams);
  const strings = STRINGS[lang];
  const toolRows = TOOL_ROWS[lang];

  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">{strings.eyebrow}</p>
        <h1>{strings.heroTitle}</h1>
        <p className="subtitle">{strings.heroSubtitle}</p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn primary cta-orange" href={withLang("/ai/connect", lang)}>
            {strings.ctaConnect}
          </a>
          <a className="for-agents-btn secondary cta-red" href={withLang("/for-agents/quickstart", lang)}>
            {strings.ctaSample}
          </a>
          <a className="for-agents-btn secondary cta-green" href={withLang("/for-agents/reference#mcp-setup", lang)}>
            {strings.ctaMcpSetup}
          </a>
        </div>
        <p className="note">{strings.heroNote}</p>
      </section>

      <section className="for-agents-grid-3">
        {strings.cards.map((card) => (
          <article className="card" key={card.title}>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </section>

      <section id="reference" className="card">
        <h2>{strings.opsTitle}</h2>
        <div className="for-agents-tool-table">
          {toolRows.map((row) => (
            <div key={row.name} className="for-agents-tool-row">
              <code>{row.name}</code>
              <span>{row.desc}</span>
            </div>
          ))}
        </div>
        <p className="muted">{strings.opsMuted}</p>
        <h3>{strings.mapTitle}</h3>
        <div className="for-agents-tool-table">
          {API_MAP_ROWS.map((row) => (
            <div key={row.tool} className="for-agents-tool-row">
              <code>{row.tool}</code>
              <span>{row.endpoint}</span>
            </div>
          ))}
        </div>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-green" href={withLang("/for-agents/reference", lang)}>
            {strings.ctaReference}
          </a>
          <a className="for-agents-btn cta-orange" href="/openapi.json">
            {strings.ctaOpenApi}
          </a>
        </div>
      </section>

      <section id="quickstart" className="card">
        <h2>{strings.quickstartTitle}</h2>
        <ol className="for-agents-steps">
          {strings.quickstartSteps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <a className="for-agents-btn secondary cta-green" href={withLang("/for-agents/quickstart", lang)}>
          {strings.quickstartCta}
        </a>
      </section>

      <section className="for-agents-grid-2">
        <article className="card">
          <h2>{strings.pricingTitle}</h2>
          <p>{strings.pricingBody}</p>
          <ul className="for-agents-list">
            {strings.pricingList.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>{strings.policyTitle}</h2>
          <ul className="for-agents-list">
            {strings.policyList.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <a className="text-link" href={withLang("/for-agents/reference", lang)}>
            {strings.policyLink}
          </a>
        </article>
      </section>

      <section className="card">
        <h2>{strings.faqTitle}</h2>
        <div className="for-agents-faq">
          {strings.faqRows.map((row) => (
            <article key={row.q}>
              <h3>{row.q}</h3>
              <p>{row.a}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="for-agents-final card">
        <h2>{strings.finalTitle}</h2>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn primary cta-orange" href={withLang("/ai/connect", lang)}>
            {strings.finalConnect}
          </a>
          <a className="for-agents-btn secondary cta-green" href={withLang("/for-agents/reference", lang)}>
            {strings.finalReference}
          </a>
        </div>
        <p className="muted">{strings.finalNote}</p>
      </section>
    </div>
  );
}
