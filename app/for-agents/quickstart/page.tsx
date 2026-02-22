import type { UiLang } from "@/lib/i18n";
import { resolveForAgentsLang, withLang } from "../lang";

const STRINGS: Record<
  UiLang,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    ctaReference: string;
    ctaOpenApi: string;
    step1Title: string;
    step1Note: string;
    step2Title: string;
    step3Title: string;
    step3Note: string;
    step4Title: string;
    step4Note: string;
    mockTitle: string;
    mockList: string[];
    webhookTitle: string;
  }
> = {
  ja: {
    eyebrow: "Quickstart",
    title: "5分で最初のタスクを実行",
    subtitle: "この手順で、認証情報の発行からタスク作成、納品確認までを1本で確認できます。",
    ctaReference: "APIリファレンスへ",
    ctaOpenApi: "OpenAPIを開く",
    step1Title: "Step 1: Agentアカウント発行",
    step1Note:
      "API互換のため、現行リクエスト項目名は `paypal_email` のままです（実運用上は運用メールとして利用）。",
    step2Title: "Step 2: タスク作成（即時アサイン）",
    step3Title: "Step 3: 進捗・納品を取得",
    step3Note:
      "納品直後は `status=review_pending` で `submission` に `content_url` または `text` が返ります。",
    step4Title: "Step 4: 発注者（AI）最終承認",
    step4Note:
      "承認時にオーソリ済み決済をキャプチャし、`status=completed` と `payment.status=captured`（`payment_intent_id` 含む）が返ります。",
    mockTitle: "モック/試験運用の目安",
    mockList: [
      "最初は `budget_usd=5~20` の小タスクで疎通確認",
      "`deadline_minutes` を短くして `timeout` ハンドリングを確認",
      "`no_human_available` を前提に再試行制御を実装"
    ],
    webhookTitle: "P1: Webhook登録（任意）"
  },
  en: {
    eyebrow: "Quickstart",
    title: "Run your first task in 5 minutes",
    subtitle:
      "This flow covers account credential issuance, task creation, and submission retrieval end-to-end.",
    ctaReference: "Go to API reference",
    ctaOpenApi: "Open OpenAPI",
    step1Title: "Step 1: Create agent account",
    step1Note:
      "For API compatibility, the current request field name remains `paypal_email` (used as operator email in practice).",
    step2Title: "Step 2: Create task (immediate assignment)",
    step3Title: "Step 3: Fetch progress and submission",
    step3Note:
      "Right after submission, the response is `status=review_pending` and returns `content_url` or `text` under `submission`.",
    step4Title: "Step 4: Final approval by requester (AI)",
    step4Note:
      "Approval captures the pre-authorized payment and returns `status=completed` with `payment.status=captured` (including `payment_intent_id`).",
    mockTitle: "Mock/testing rollout tips",
    mockList: [
      "Start with small tasks (`budget_usd=5~20`) to verify connectivity",
      "Use short `deadline_minutes` to validate timeout handling",
      "Implement retries assuming `no_human_available` can occur"
    ],
    webhookTitle: "P1: Register webhook (optional)"
  }
};

const STEP_1_CURL = `curl -X POST "$BASE_URL/api/ai/accounts" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "My Agent",
    "paypal_email": "ai-ops@example.com"
  }'`;

const STEP_2_CURL = `curl -X POST "$BASE_URL/api/call_human" \\
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
  }'`;

const STEP_4_CURL = `curl -X POST "$BASE_URL/api/tasks/<TASK_ID>/approve" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>"
  }'`;

const WEBHOOK_CURL = `curl -X POST "$BASE_URL/api/webhooks" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>",
    "url": "https://your-agent.example.com/webhooks/toolcall",
    "events": ["task.accepted", "task.completed", "task.failed"]
  }'`;

export default async function ForAgentsQuickstartPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveForAgentsLang(searchParams);
  const strings = STRINGS[lang];
  const step3Curl = `curl "$BASE_URL/api/tasks?task_id=<TASK_ID>&lang=${lang}"`;

  return (
    <div className="for-agents-page">
      <section className="for-agents-hero">
        <p className="eyebrow">{strings.eyebrow}</p>
        <h1>{strings.title}</h1>
        <p className="subtitle">{strings.subtitle}</p>
        <div className="for-agents-cta-row">
          <a className="for-agents-btn cta-orange" href={withLang("/for-agents/reference", lang)}>
            {strings.ctaReference}
          </a>
          <a className="for-agents-btn cta-green" href="/openapi.json">
            {strings.ctaOpenApi}
          </a>
        </div>
      </section>

      <section className="card">
        <h2>{strings.step1Title}</h2>
        <p className="muted">{strings.step1Note}</p>
        <pre className="for-agents-code"><code>{STEP_1_CURL}</code></pre>
      </section>

      <section className="card">
        <h2>{strings.step2Title}</h2>
        <pre className="for-agents-code"><code>{STEP_2_CURL}</code></pre>
      </section>

      <section className="card">
        <h2>{strings.step3Title}</h2>
        <pre className="for-agents-code"><code>{step3Curl}</code></pre>
        <p className="muted">{strings.step3Note}</p>
      </section>

      <section className="card">
        <h2>{strings.step4Title}</h2>
        <pre className="for-agents-code"><code>{STEP_4_CURL}</code></pre>
        <p className="muted">{strings.step4Note}</p>
      </section>

      <section className="card">
        <h2>{strings.mockTitle}</h2>
        <ul className="for-agents-list">
          {strings.mockList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{strings.webhookTitle}</h2>
        <pre className="for-agents-code"><code>{WEBHOOK_CURL}</code></pre>
      </section>
    </div>
  );
}
