# Sinkai 人向けSEO: 新規記事方針とリライト方針

対象:
- 人向けSEO
- 目的は `登録`, `案件一覧`, `応募/受注` の導線を作ること

関連:
- [for-humans-replan-2026-03-13.md](/Users/tetubrah/Projects/Tool_Call_For_LLM/docs/seo/for-humans-replan-2026-03-13.md)
- [for-agents-ja-inventory-2026-03-13.md](/Users/tetubrah/Projects/Tool_Call_For_LLM/docs/seo/for-agents-ja-inventory-2026-03-13.md)

## 前提

人向けSEOでは、`AIエージェント`, `API`, `MCP`, `OpenAPI` は主語にしない。

主語は常に:
- 仕事を探している人
- 副業を探している人
- 単発案件を受けたい人
- 未経験で始められるか不安な人

記事で最終的に答えるべきこと:
- どんな仕事か
- 自分でもできるか
- どう始めるか
- どこから案件を見るか

## 新規記事方針

### 1. 狙う検索意図

新規記事は次の4つに限定する。

1. 仕事探し
2. 副業探し
3. 未経験/安全性の不安解消
4. 仕事内容の具体理解

避ける意図:
- 技術比較
- API導入
- 発注者向け運用
- AI導入一般論

### 2. 記事テーマの優先順

優先度 `P1`:
- `現地確認 仕事`
- `写真撮影 単発バイト`
- `現地調査 副業`
- `日本語調査 副業`
- `写真を撮って報酬を得る仕事`
- `単発 調査 仕事`

優先度 `P2`:
- `未経験 現地確認 仕事`
- `副業 安全 単発仕事`
- `スキマ時間 外出仕事`
- `簡単調査 バイト`
- `報酬 受け取り 副業`
- `登録だけで始められる仕事`

優先度 `P3`:
- `AI時代 人にしかできない仕事`
- `現地でしかできない仕事`
- `人の最終確認が必要な仕事`

### 3. 記事の型

新規記事は次の3タイプだけ使う。

タイプA: 仕事理解記事
- 例: `現地確認の仕事とは`
- 目的: 仕事内容の理解

タイプB: 不安解消記事
- 例: `未経験でもできるか`
- 目的: 登録前の不安を潰す

タイプC: 比較・選び方記事
- 例: `単発の外出仕事を選ぶポイント`
- 目的: 他手段と比較してSinkaiに誘導

### 4. 記事の必須構成

すべての記事は次の順にする。

1. 冒頭で検索意図に即答
2. どんな仕事かを具体例で説明
3. 向いている人 / 向いていない人
4. 始め方
5. よくある不安
6. CTA

### 5. CTAルール

CTAは最大2つ。

固定:
- `登録する` -> `/auth`
- `案件一覧を見る` -> `/tasks`

補助CTAを入れるなら:
- `マイページを見る` -> `/me`

禁止:
- `for-agents`
- `quickstart`
- `reference`
- `openapi`

### 6. 言葉づかいルール

使う:
- 仕事
- 副業
- 単発案件
- 現地確認
- 写真撮影
- 調査
- スマホでできる
- 未経験
- 報酬

避ける:
- エージェント
- API
- MCP
- tool call
- 実装
- オーケストレーション

### 7. 量産ルール

- 月8本まで
- 1記事1キーワードに絞る
- 同義語での量産はしない
- 1本ごとに `auth` か `tasks` のどちらを主CTAにするか決める

## 新規記事テーマ案

### P1で先に作る6本

1. `現地確認の仕事とは？未経験でも始めやすい単発案件の特徴`
2. `写真撮影の単発バイトとは？スマホでできる仕事の始め方`
3. `現地調査の副業とは？外出してできる仕事の内容と向いている人`
4. `日本語調査の副業とは？情報収集系の単発案件でできること`
5. `写真を撮って報酬を得る仕事はある？案件の種類と注意点`
6. `単発の調査仕事を探す人向けガイド`

### 不安解消で続けて作る4本

1. `未経験でも現地確認の仕事はできる？`
2. `単発副業は安全？登録前に確認したいポイント`
3. `報酬はどう受け取る？単発案件の支払いイメージ`
4. `スキマ時間でできる外出仕事の探し方`

## リライト方針

### 1. リライト対象の考え方

既存記事は3分類で扱う。

`全面改稿`:
- タイトルも本文も人向けへ作り直す

`部分転用`:
- 構成や一部説明だけ使う

`凍結`:
- 人向けSEOでは使わない

### 2. 全面改稿の対象

- `01-onsite-verification-api-intro.md`
- `05-real-estate-template.md`
- `06-jp-local-research-workflow.md`
- `25-ai-customer-support-handoff-design.md`
- `27-ai-meeting-minutes-automation.md`
- `30-ai-agent-small-team-rollout.md`
- `46-ai-agent-human-review-thresholds.md`
- `48-ai-agent-usecase-prioritization-framework.md`
- `54-ai-agent-field-adoption-playbook.md`

全面改稿ルール:
- タイトルから技術語を消す
- 冒頭3段落以内に `どんな仕事か`, `誰向けか`, `どう始めるか` を入れる
- CTAを `登録する` と `案件一覧を見る` に統一する
- 仕事内容の具体例を最低3つ入れる
- 報酬/難易度/必要なものの説明を入れる

### 3. 部分転用の対象

- `04-no-human-timeout-ops-design.md`
- `08-white-collar-job-design.md`
- `09-white-collar-kpi.md`
- `10-white-collar-transition-plan.md`
- `17-non-tech-ai-education-painpoints.md`
- `18-ai-team-collaboration-practical-issues.md`
- `22-ai-roi-measurement-template.md`
- `23-ai-poc-scope-design.md`
- `26-internal-faq-ai-accuracy-improvement.md`
- `31-ai-data-readiness-checklist.md`
- `33-ai-operations-runbook-template.md`
- `41-ai-knowledge-succession-after-automation.md`
- `50-ai-agent-operating-model-inhouse-vs-outsourcing.md`

部分転用ルール:
- 本文の中の `人が必要な理由`, `失敗しやすい点`, `具体例`, `判断が必要な場面` だけ抜く
- 新しい人向け記事の材料に使う
- 元記事のslugやテーマはそのまま使わない

### 4. 凍結対象

技術、法務、調達、管理、AI導入一般論の記事は凍結する。

代表例:
- `02-mcp-quickstart.md`
- `03-call-human-fast-implementation.md`
- `19-ai-adoption-approval-process.md`
- `20-ai-agent-sla-design.md`
- `21-ai-compliance-checklist-japan.md`
- `24-rag-knowledge-base-operations.md`
- `28-ai-vendor-selection-checkpoints.md`
- `32-prompt-governance-template.md`
- `35-ai-budget-approval-template.md`
- `40-generative-ai-legal-review-playbook.md`
- `43-ai-agent-incident-response-playbook.md`
- `44-ai-agent-cost-control-playbook.md`
- `45-ai-agent-sandbox-evaluation-criteria.md`
- `47-ai-agent-access-control-design.md`
- `49-ai-agent-audit-log-design.md`
- `51-ai-agent-change-management-playbook.md`
- `52-ai-agent-rfp-requirements-template.md`
- `53-ai-agent-vendor-lockin-exit-strategy.md`

## リライトの実務ルール

### 1. タイトル変換ルール

変換前:
- `現地確認 API`
- `AIエージェント 人間レビュー`
- `call_human_fast 実装`

変換後:
- `現地確認の仕事とは`
- `人の最終確認が必要な仕事`
- `写真撮影や確認作業の単発案件`

### 2. 冒頭変換ルール

変換前:
- 技術背景やプロダクト説明から入る

変換後:
- 「この仕事は何をするのか」
- 「どんな人に向いているのか」
- 「登録後に何ができるか」

### 3. セクション変換ルール

最低限入れる見出し:
- どんな仕事か
- 具体的な仕事内容
- 向いている人
- 始め方
- 注意点
- よくある質問

### 4. CTA変換ルール

記事下CTAの固定形:
- `登録して始める`
- `案件一覧を見る`

## 優先実行順

### Phase 1

- 新規6本を先に作る
- 既存の全面改稿9本は後回し

理由:
- 既存記事は前提が違いすぎて、直すより新規で作るほうが早い

### Phase 2

- 全面改稿対象のうち 01, 05, 06 を先に直す

理由:
- `現地確認`, `写真`, `調査` の軸に近い

### Phase 3

- FAQ / 安全性 / 報酬記事を増やす

## KPI

- 新規記事の `blog -> auth` CTR
- 新規記事の `blog -> tasks` CTR
- リライト記事のCTR改善率
- `未経験`, `副業`, `単発` 系キーワードの表示回数
- `auth` 到達後のプロフィール開始率

## 結論

人向けSEOでは、既存の agent 向け記事を主力にしない。

先にやるべきことは:
- 人向けの新規記事を作る
- 既存記事は一部だけ厳選して全面改稿する
- すべての導線を `登録` と `案件一覧` に統一する
