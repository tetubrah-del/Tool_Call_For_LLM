# 現地確認APIとは？AIだけでは完了できない業務を自動化する導入ガイド

## SEOメモ
- slug案: `onsite-verification-api-guide`
- primary keyword: `現地確認 API`
- secondary keywords: `AI エージェント 現実世界`, `human in the loop API`, `実地確認 自動化`
- search intent: 導入判断（情報収集 + 比較検討）
- title案: `現地確認APIとは？AIエージェントに現実世界の実行力を追加する方法`
- meta description案: `AIだけでは完了できない現地確認業務を、SinkaiのAPI/MCPで実行するための導入ガイド。向いている業務、導入手順、KPI設計まで整理。`

AIエージェントが強いのは、情報処理と意思決定です。弱いのは、現地に行くこと・写真を撮ること・人に確認することです。

このギャップを埋めるのが、現地確認APIです。Sinkaiでは、AIがタスクを発注し、人が現地で実行し、結果をAPIで回収できます。

## AIだけでは完了しない業務の具体例

- 店舗や物件の現地状態を確認する
- 指定場所の写真・動画を取得する
- 日本語でしか取れないローカル情報を集める
- AI出力の最終確認を人で実施する

共通点は「外界との接点が必要」な点です。

## 現地確認APIで得られる価値

- オペレーションをコード化できる
- `status` と `failure_reason` で分岐設計がしやすい
- 納品物（photo/video/text）を後続処理に直結できる
- 人手運用の属人化を下げられる

## Sinkaiが向くケース・向かないケース

### 向くケース

- まずは小さな検証タスクを回したい
- エージェント実装に組み込みたい
- 失敗時の再試行制御を自前で設計したい

### 向かないケース

- 厳密SLAを前提にした大規模運用を初日から求める
- 仕様不明のまま高難度案件を一気に投入する

## 導入の最短フロー

1. `POST /api/ai/accounts` で `account_id` と `api_key` を取得
2. `POST /api/call_human` で最初の1件を実行
3. `GET /api/tasks?task_id=...` で進捗を監視
4. `POST /api/tasks/:taskId/approve` で完了確定

実運用では、同じユースケースを3回連続で回し、再現性を確認してから本番導入するのが安全です。

## KPIの置き方（最初の30日）

- 受諾率（`open -> accepted`）
- 完了率（`completed / (completed + failed)`）
- 平均所要時間
- 失敗理由別件数（`no_human_available`, `timeout` など）
- 手動介入率

この5つだけで、改善優先順位を十分に決められます。

## FAQ

### Q. MCP未対応でも使えますか？
はい。REST APIで開始できます。

### Q. 最低予算はいくらですか？
現行MVPでは `$5` 以上です。

### Q. まず何から試すべきですか？
1件の低リスクな現地確認（写真1枚）から始めるのが最短です。

## CTA

- まずは接続: `https://sinkai.tokyo/for-agents`
- 5分手順: `https://sinkai.tokyo/for-agents/quickstart`
- 仕様確認: `https://sinkai.tokyo/for-agents/reference`
