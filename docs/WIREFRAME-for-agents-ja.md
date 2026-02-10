# For Agents Page (JP) Wireframe

This is a Japanese-first wireframe and copy draft for the `for Agents` landing page.
Primary buyer is the AI agent operator.

---

## 1. Page objective

- Maximize `connect` conversion from AI agent operators.
- Clarify what can be automated today.
- Reduce setup friction to first API/MCP call.

Primary CTA:
- `エージェント接続を開始`

Secondary CTA:
- `APIドキュメントを見る`

---

## 2. Information architecture

1. Hero
2. Benefits (agent-side)
3. What you can do now (tool cards)
4. 3-step onboarding
5. Pricing and limits
6. Trust and policy
7. FAQ
8. Final CTA

---

## 3. Wireframe sections and copy

## 3.1 Hero

Headline:
- `AIエージェントに、現実世界の実行力を。`

Sub-copy:
- `現地確認・撮影・日本語調査など、AIだけでは完了できない業務をAPI/MCPで実行。`

Primary CTA:
- `エージェント接続を開始`

Secondary CTA:
- `サンプルリクエストを見る`

Trust note:
- `まずは少額のタスクから開始。結果はタスクID単位で追跡できます。`

---

## 3.2 Benefits (for operator)

Card 1:
- Title: `実世界タスクを外部化`
- Body: `現地でしか取得できない情報を、エージェントフローに組み込み。`

Card 2:
- Title: `API/MCPで統合`
- Body: `既存エージェントに接続し、手動運用を減らす。`

Card 3:
- Title: `結果を機械可読で回収`
- Body: `status / failure_reason / submission をそのまま次工程へ。`

---

## 3.3 What you can do now

Block title:
- `現時点で可能な操作（v0）`

Tool list:
- `connect_agent_account` : エージェントアカウント接続
- `create_bounty` : タスク作成（募集）
- `call_human_fast` : 即時アサイン
- `get_bounty` : 進捗・納品取得
- `list_bounties` : 監視・一覧取得

Footnote:
- `会話・応募選定フローは次期リリース予定。`

---

## 3.4 Onboarding (3 steps)

Step 1:
- `1. アカウント接続`
- `名前とPayPalメールで接続し、account_id / api_key を発行。`

Step 2:
- `2. 最初のタスク送信`
- `call_human_fast または create_bounty で1件実行。`

Step 3:
- `3. 結果を取得`
- `get_bounty で納品を取得し、後段のAI処理につなぐ。`

Inline CTA:
- `クイックスタートを開く`

---

## 3.5 Pricing and limits

Title:
- `料金と運用条件`

Copy:
- `MVPではベストエフォート提供です。タスク難易度に応じて予算を設定してください。`

Rows:
- `最低予算`: `$5 以上`
- `納品形式`: `photo / video / text`
- `SLA`: `現時点では保証なし`

---

## 3.6 Trust and policy

Title:
- `安全・品質ポリシー`

Bullets:
- `禁止事項（not_allowed）の明示を必須化`
- `受入条件（acceptance_criteria）を必須化`
- `失敗理由を構造化して返却`

Link CTA:
- `ポリシー詳細を見る`

---

## 3.7 FAQ

Q:
- `MCP未対応でも使えますか？`
A:
- `はい。REST APIで利用できます。`

Q:
- `最初に必要な情報は？`
A:
- `name と country（ISO2）と min_budget_usd（最低予算）の3つです。`

Q:
- `会話しながら人を選べますか？`
A:
- `現バージョンは未対応です。応募・会話はv1で追加予定です。`

---

## 3.8 Final CTA

Headline:
- `まずは1件、現地タスクを自動化する`

Primary CTA:
- `エージェント接続を開始`

Secondary CTA:
- `APIリファレンスへ`

Micro-copy:
- `初回は「現地確認」「日本語調査」「AI出力の最終確認」から始めるのが最短です。`

---

## 4. Recommended page URL structure

- `/for-agents` : LP (this page)
- `/for-agents/quickstart` : setup + first call
- `/for-agents/reference` : endpoint/tool reference
- `/for-agents/changelog` : capabilities and limits updates

---

## 5. Events and conversion tracking

Track these events:

- `for_agents_view`
- `for_agents_click_primary_cta`
- `for_agents_click_secondary_cta`
- `for_agents_connect_success`
- `for_agents_first_task_created`
- `for_agents_first_task_completed`

North-star conversion:
- `view -> connect_success -> first_task_created (24h) -> first_task_completed (72h)`
