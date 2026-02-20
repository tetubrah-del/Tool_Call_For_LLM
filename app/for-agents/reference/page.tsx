import type { UiLang } from "@/lib/i18n";
import { resolveForAgentsLang, withLang } from "../lang";

const LIFECYCLE = [
  "open -> accepted -> review_pending -> completed",
  "open -> failed",
  "accepted -> failed"
];

const ERRORS = [
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

const STRINGS: Record<
  UiLang,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    ctaOpenApi: string;
    ctaQuickstart: string;
    authTitle: string;
    authList: string[];
    mcpTitle: string;
    mcpList: string[];
    mcpServersTitle: string;
    mcpServersNote: string;
    endpointsTitle: string;
    endpointsList: string[];
    idempotencyTitle: string;
    idempotencyList: string[];
    lifecycleTitle: string;
    opsTitle: string;
    opsList: string[];
    webhookTitle: string;
    webhookList: string[];
    errorsTitle: string;
    errorsDesc: string;
  }
> = {
  ja: {
    eyebrow: "Reference",
    title: "Agent APIリファレンス",
    subtitle: "認証、タスクライフサイクル、エラー、運用条件をエージェント実装向けにまとめています。",
    ctaOpenApi: "OpenAPI JSON",
    ctaQuickstart: "Quickstart",
    authTitle: "認証",
    authList: [
      "`POST /api/ai/accounts` で `account_id` と `api_key` を発行",
      "タスク作成系APIでは `ai_account_id` と `ai_api_key` を送信",
      "キーはログ出力しないことを推奨"
    ],
    mcpTitle: "MCP接続情報（現行）",
    mcpList: [
      "Transport: stdio（ローカル実行）",
      "公開HTTP MCP URL: 現時点では未提供",
      "実装済みツール: `connect_agent_account`, `create_bounty`, `call_human_fast`, `get_bounty`, `approve_bounty_completion`, `reject_bounty_completion`, `list_bounties`",
      "認証: `DEFAULT_AI_ACCOUNT_ID`, `DEFAULT_AI_API_KEY` もしくは各ツール入力で渡す"
    ],
    mcpServersTitle: "mcpServers 設定例（そのまま貼り付け）",
    mcpServersNote:
      "以下はローカルで `mcp-server/src/index.mjs` を使う設定例です。`<ACCOUNT_ID>` と `<API_KEY>` は接続済みの値に置き換えてください。",
    endpointsTitle: "エンドポイント（P0）",
    endpointsList: [
      "`POST /api/ai/accounts`",
      "`POST /api/tasks`",
      "`POST /api/call_human`",
      "`GET /api/tasks?task_id=...`",
      "`POST /api/tasks/:taskId/approve`",
      "`POST /api/tasks/:taskId/reject`",
      "`GET /api/tasks?task_label=...&q=...`"
    ],
    idempotencyTitle: "P1: Idempotency-Key",
    idempotencyList: [
      "`POST /api/tasks` と `POST /api/call_human` で `Idempotency-Key` ヘッダー対応",
      "同一キー + 同一リクエストは前回レスポンスを再生",
      "同一キー + 異なるリクエストは `idempotency_key_conflict` を返却"
    ],
    lifecycleTitle: "タスクライフサイクル",
    opsTitle: "運用条件（MVP）",
    opsList: [
      "最低予算: `$5`（`below_min_budget` 返却）",
      "Timeout: `deadline_minutes` 到達で `timeout` へ遷移",
      "キャンセル/返金: 現在は自動返金フロー未実装",
      "レート制限: 現在は公開固定値なし（v1で明文化予定）"
    ],
    webhookTitle: "P1: Webhook",
    webhookList: [
      "`POST /api/webhooks` で登録、`GET /api/webhooks` で一覧取得",
      "イベント: `task.accepted`, `task.completed`, `task.failed`",
      "署名: `X-ToolCall-Signature: sha256=...`"
    ],
    errorsTitle: "エラーコード",
    errorsDesc: "reasonとして返却される値"
  },
  en: {
    eyebrow: "Reference",
    title: "Agent API Reference",
    subtitle:
      "Authentication, task lifecycle, errors, and operating constraints for agent implementations.",
    ctaOpenApi: "OpenAPI JSON",
    ctaQuickstart: "Quickstart",
    authTitle: "Authentication",
    authList: [
      "Issue `account_id` and `api_key` via `POST /api/ai/accounts`",
      "Send `ai_account_id` and `ai_api_key` on task creation APIs",
      "Do not log API keys"
    ],
    mcpTitle: "MCP connection info (current)",
    mcpList: [
      "Transport: stdio (local execution)",
      "Public HTTP MCP URL: not available yet",
      "Implemented tools: `connect_agent_account`, `create_bounty`, `call_human_fast`, `get_bounty`, `approve_bounty_completion`, `reject_bounty_completion`, `list_bounties`",
      "Auth: pass `DEFAULT_AI_ACCOUNT_ID` / `DEFAULT_AI_API_KEY` or per-tool inputs"
    ],
    mcpServersTitle: "mcpServers config examples (copy/paste)",
    mcpServersNote:
      "These examples use local `mcp-server/src/index.mjs`. Replace `<ACCOUNT_ID>` and `<API_KEY>` with your connected values.",
    endpointsTitle: "Endpoints (P0)",
    endpointsList: [
      "`POST /api/ai/accounts`",
      "`POST /api/tasks`",
      "`POST /api/call_human`",
      "`GET /api/tasks?task_id=...`",
      "`POST /api/tasks/:taskId/approve`",
      "`POST /api/tasks/:taskId/reject`",
      "`GET /api/tasks?task_label=...&q=...`"
    ],
    idempotencyTitle: "P1: Idempotency-Key",
    idempotencyList: [
      "`POST /api/tasks` and `POST /api/call_human` support `Idempotency-Key`",
      "Same key + same request replays the previous response",
      "Same key + different request returns `idempotency_key_conflict`"
    ],
    lifecycleTitle: "Task lifecycle",
    opsTitle: "Operating constraints (MVP)",
    opsList: [
      "Minimum budget: `$5` (returns `below_min_budget`)",
      "Timeout: moves to `timeout` when `deadline_minutes` is reached",
      "Cancel/refund: automatic refund flow is not implemented yet",
      "Rate limit: no public fixed value yet (to be documented in v1)"
    ],
    webhookTitle: "P1: Webhook",
    webhookList: [
      "Register with `POST /api/webhooks`, list with `GET /api/webhooks`",
      "Events: `task.accepted`, `task.completed`, `task.failed`",
      "Signature: `X-ToolCall-Signature: sha256=...`"
    ],
    errorsTitle: "Error codes",
    errorsDesc: "Returned as `reason` values"
  }
};

const MCP_SERVER_CLI = `# local MCP server
cd mcp-server
npm install
BASE_URL=https://sinkai.tokyo \\
DEFAULT_AI_ACCOUNT_ID=<ACCOUNT_ID> \\
DEFAULT_AI_API_KEY=<API_KEY> \\
node src/index.mjs`;

const MCP_SERVERS_JSON = `{
  "mcpServers": {
    "call-human": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/Tool_Call_For_LLM/mcp-server/src/index.mjs"],
      "env": {
        "BASE_URL": "https://sinkai.tokyo",
        "DEFAULT_AI_ACCOUNT_ID": "<ACCOUNT_ID>",
        "DEFAULT_AI_API_KEY": "<API_KEY>"
      }
    }
  }
}`;

export default async function ForAgentsReferencePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveForAgentsLang(searchParams);
  const strings = STRINGS[lang];

  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">{strings.eyebrow}</p>
        <h1>{strings.title}</h1>
        <p className="subtitle">{strings.subtitle}</p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-green" href="/openapi.json">
            {strings.ctaOpenApi}
          </a>
          <a className="for-agents-btn cta-orange" href={withLang("/for-agents/quickstart", lang)}>
            {strings.ctaQuickstart}
          </a>
        </div>
      </section>

      <section className="card">
        <h2>{strings.authTitle}</h2>
        <ul className="for-agents-list">
          {strings.authList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section id="mcp-setup" className="card">
        <h2>{strings.mcpTitle}</h2>
        <ul className="for-agents-list">
          {strings.mcpList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <pre className="for-agents-code"><code>{MCP_SERVER_CLI}</code></pre>
      </section>

      <section className="card">
        <h2>{strings.mcpServersTitle}</h2>
        <p className="muted">{strings.mcpServersNote}</p>
        <h3>Claude Desktop</h3>
        <pre className="for-agents-code"><code>{MCP_SERVERS_JSON}</code></pre>
        <h3>Cursor</h3>
        <pre className="for-agents-code"><code>{MCP_SERVERS_JSON}</code></pre>
      </section>

      <section className="card">
        <h2>{strings.endpointsTitle}</h2>
        <ul className="for-agents-list">
          {strings.endpointsList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.idempotencyTitle}</h2>
        <ul className="for-agents-list">
          {strings.idempotencyList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.lifecycleTitle}</h2>
        <ul className="for-agents-list">
          {LIFECYCLE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.opsTitle}</h2>
        <ul className="for-agents-list">
          {strings.opsList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.webhookTitle}</h2>
        <ul className="for-agents-list">
          {strings.webhookList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.errorsTitle}</h2>
        <div className="for-agents-tool-table">
          {ERRORS.map((reason) => (
            <div className="for-agents-tool-row" key={reason}>
              <code>{reason}</code>
              <span>{strings.errorsDesc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
