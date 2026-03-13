# Sinkai SEO棚卸し 2026-03-13

対象: `docs/seo/for-agents-ja` の既存記事 55 本

評価基準:
- `残す`: `for-agents` の商談導線に近く、主戦場に残す
- `更新`: 検索意図は使えるが、Sinkai導線とユースケース接続を強める必要がある
- `優先度下げ`: 流入は取れても、現行プロダクトの導入導線から遠い

主戦場:
- AIエージェントに現実世界実行力を足す
- human-in-the-loop / call human / 現地確認 / 日本語ローカル調査
- 導入初期の実装、失敗設計、運用設計

## 判定サマリ

| 区分 | 件数 | 方針 |
| --- | ---: | --- |
| 残す | 15 | そのまま主力。内部リンクとCTAのみ統一 |
| 更新 | 23 | テーマは活かしつつ、現場実行・API導線に寄せて再編集 |
| 優先度下げ | 17 | 新規投資を止め、関連導線だけ残す |

## 残す

| No | slug | primary keyword | 判定理由 |
| --- | --- | --- | --- |
| 01 | `onsite-verification-api-guide` | `現地確認 API` | コア価値に直結する柱記事 |
| 02 | `sinkai-mcp-quickstart` | `MCP 接続 Sinkai` | 接続意図が強くCVに近い |
| 03 | `call-human-fast-implementation` | `call_human_fast 実装` | 実装検索に対する最短導線 |
| 04 | `no-human-timeout-ops-design` | `no_human_available timeout 対策` | 運用課題がプロダクト固有価値に直結 |
| 05 | `real-estate-onsite-verification-template` | `不動産 現地確認 API` | 業界ユースケースとして強い |
| 06 | `jp-local-research-ai-workflow` | `日本語ローカル調査 AI` | Sinkaiの差別化に直結 |
| 20 | `ai-agent-sla-design` | `AIエージェント SLA` | 導入運用の検討フェーズに刺さる |
| 25 | `ai-customer-support-handoff-design` | `AI問い合わせ 自動化` | human handoff設計に接続しやすい |
| 30 | `ai-agent-small-team-rollout` | `AIエージェント 導入` | 小規模導入の実装意図を取れる |
| 43 | `ai-agent-incident-response-playbook` | `AIエージェント インシデント対応` | エージェント運用実務に近い |
| 44 | `ai-agent-cost-control-playbook` | `AIエージェント 運用コスト管理` | 導入後の実務課題として強い |
| 45 | `ai-agent-sandbox-evaluation-criteria` | `AIエージェント サンドボックス検証` | 比較検討フェーズに合う |
| 46 | `ai-agent-human-review-thresholds` | `AIエージェント 人間レビュー基準` | human-in-the-loopの核心テーマ |
| 48 | `ai-agent-usecase-prioritization-framework` | `AIエージェント 導入優先順位` | 導入初期の意思決定に合う |
| 54 | `ai-agent-field-adoption-playbook` | `AIエージェント 現場定着` | 導入実務とCV導線の相性がよい |

## 更新

| No | slug | primary keyword | 更新方針 |
| --- | --- | --- | --- |
| 08 | `white-collar-job-design-ai-human` | `AI 人 分業 ホワイトカラー` | 一般論を減らし、review/handoff設計へ寄せる |
| 09 | `white-collar-ai-kpi-design` | `AI導入 KPI ホワイトカラー` | 現場運用KPIを `task completion / retry / handoff` に寄せる |
| 10 | `white-collar-ai-transition-90days` | `AI移行計画 ホワイトカラー` | `for-agents` 導入90日計画として再編集 |
| 17 | `non-tech-ai-education-painpoints` | `非技術職AI教育` | 現場オペレーター教育と運用定着文脈へ寄せる |
| 18 | `ai-team-collaboration-practical-issues` | `AIチームコラボレーション` | エージェント+人間分業の実務設計に再接続 |
| 19 | `ai-adoption-approval-process` | `AI導入 稟議` | `現地確認API/human-in-the-loop` の稟議テンプレへ寄せる |
| 21 | `ai-compliance-checklist-japan` | `AI導入 コンプライアンス` | API外部実行・人手介在の統制観点を前面化 |
| 22 | `ai-roi-measurement-template` | `AI導入 ROI` | Sinkai導入時のROIテンプレとして再構成 |
| 23 | `ai-poc-scope-design` | `AI PoC 進め方` | `現地確認/人間レビュー` PoCに寄せる |
| 24 | `rag-knowledge-base-operations` | `RAG ナレッジベース` | RAG単体ではなく実行系との接続文脈に寄せる |
| 26 | `internal-faq-ai-accuracy-improvement` | `社内FAQ AI` | 高リスク回答時の人手確認導線へ寄せる |
| 27 | `ai-meeting-minutes-automation` | `議事録 AI` | 直接性は弱いのでAI出力の最終確認運用に接続 |
| 28 | `ai-vendor-selection-checkpoints` | `AIベンダー 選定` | ベンダー比較ではなく実行系APIの選定基準へ寄せる |
| 31 | `ai-data-readiness-checklist` | `AI導入 データ整備` | 導入準備記事として `PoC before execution` に寄せる |
| 32 | `prompt-governance-template` | `プロンプト管理` | 単独運用からエージェント運用統制へ寄せる |
| 33 | `ai-operations-runbook-template` | `AI運用 手順書` | `call human` を含むRunbook設計へ更新 |
| 35 | `ai-budget-approval-template` | `AI導入 稟議` | 19と重複気味。統合候補 |
| 38 | `ai-executive-reporting-template` | `AI導入 報告書` | 導入報告をエージェント運用KPIに寄せる |
| 39 | `shadow-ai-governance-playbook` | `シャドーAI 対策` | human-in-the-loop導入統制として整理 |
| 40 | `generative-ai-legal-review-playbook` | `生成AI 法務レビュー` | 外部実行、現地確認、有人介在の法務論点へ寄せる |
| 47 | `ai-agent-access-control-design` | `AIエージェント 権限管理` | 実行API権限設計に寄せる |
| 49 | `ai-agent-audit-log-design` | `AIエージェント 監査ログ設計` | 監査ログ系を1本の柱記事に統合検討 |
| 50 | `ai-agent-operating-model-inhouse-vs-outsourcing` | `AIエージェント 内製 外注` | Sinkaiの外部実行部分との対比を強める |

## 優先度下げ

| No | slug | primary keyword | 理由 |
| --- | --- | --- | --- |
| 07 | `white-collar-ai-shift-overview` | `AI ホワイトカラー業務変化` | 検索意図が広すぎてCVまで遠い |
| 11 | `ai-and-human-social-life-editorial` | `AI 10年 仕事 変化` | 論考色が強く商談に繋がりにくい |
| 12 | `ai-era-middle-manager-editorial` | `AI時代 中間管理職 評価` | ペルソナが広くプロダクトとの距離がある |
| 13 | `generative-ai-failure-patterns-editorial` | `生成AI 導入 失敗` | 汎用テーマで競争が広い |
| 14 | `why-ai-work-feels-exhausting-editorial` | `AI 仕事 疲れる 理由` | 情報収集意図でCVから遠い |
| 15 | `ai-era-hiring-editorial` | `AI時代 採用 基準` | 採用テーマは主戦場外 |
| 16 | `ai-sales-relationship-shift` | `AIと営業職` | プロダクト接続が弱い |
| 29 | `backoffice-ai-workflow-redesign` | `バックオフィス AI` | 幅広すぎてSinkaiに閉じにくい |
| 34 | `ai-training-program-internal` | `AI研修 社内` | 教育テーマ単体は導線が弱い |
| 36 | `ai-guideline-update-process` | `生成AI ガイドライン` | 汎用ガバナンスで競合が多い |
| 37 | `ai-champion-program-design` | `AI推進担当` | 導入推進の一般論に寄る |
| 41 | `ai-knowledge-succession-after-automation` | `AI自動化 暗黙知` | 興味は取れても製品導線が遠い |
| 42 | `cross-border-ai-data-governance` | `AI データ移転 ルール` | 法務広義テーマで関連度が薄い |
| 43b | `ai-audit-log-design` | `AI 監査ログ` | 49と役割重複。非エージェント寄り |
| 51 | `ai-agent-change-management-playbook` | `AIエージェント 変更管理` | 競争性に対してCV仮説が弱い |
| 52 | `ai-agent-rfp-requirements-template` | `AIエージェント RFP` | 調達フェーズは有効だが今は優先度を下げる |
| 53 | `ai-agent-vendor-lockin-exit-strategy` | `AIエージェント ベンダーロックイン` | リスク論点としては有効だがCVまで遠い |

## 統合候補

- `19-ai-adoption-approval-process.md` と `35-ai-budget-approval-template.md`
- `43-ai-audit-log-design.md` と `49-ai-agent-audit-log-design.md`

## すぐやる編集ルール

- 各記事のCTAは最大2つに絞る
- 記事末尾に関連記事を3件固定表示する
- すべての記事を `for-agents` / `quickstart` / `reference` のいずれかに確実に接続する
- 一般論の導入段落を削り、`現地確認`, `日本語調査`, `human review`, `call human` の具体シーンを前半へ移す
