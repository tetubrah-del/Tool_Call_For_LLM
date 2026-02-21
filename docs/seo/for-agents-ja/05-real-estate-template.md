# 不動産向け: 現地確認タスクのテンプレート設計

## SEOメモ
- slug案: `real-estate-onsite-verification-template`
- primary keyword: `不動産 現地確認 API`
- secondary keywords: `物件確認 自動化`, `real world verification`, `AI 不動産 オペレーション`
- search intent: 業界ユースケース（不動産で試したい）
- title案: `不動産向け現地確認APIテンプレート: 物件確認フローを標準化する`
- meta description案: `不動産業務でSinkaiを使う際の現地確認テンプレートを紹介。依頼文、受入条件、禁止事項、失敗時の運用まで実装目線で解説。`

不動産ユースケースは「何を撮るか」「どこまで確認するか」が曖昧だと失敗します。テンプレート化してから投入すると成功率が上がります。

## テンプレートの基本構造

- `task`: 現地作業の指示
- `acceptance_criteria`: 合格判定条件
- `not_allowed`: 安全・法務上の禁止事項
- `deliverable`: `photo` か `video`

## そのまま使えるリクエスト例

```json
{
  "task": "対象物件の外観・入口・表札の写真を撮影してください",
  "ai_account_id": "<ACCOUNT_ID>",
  "ai_api_key": "<API_KEY>",
  "origin_country": "JP",
  "task_label": "real_world_verification",
  "acceptance_criteria": "外観1枚、入口1枚、表札1枚の計3枚。文字が判読可能であること。",
  "not_allowed": "私有地への立ち入り、住人への接触、室内撮影は禁止。",
  "location": "新宿区○○",
  "budget_usd": 30,
  "deliverable": "photo",
  "deadline_minutes": 60
}
```

## 受入条件の書き方

悪い例: 「わかるように撮影してください」

良い例:

- 枚数を指定する
- 判読条件を指定する
- 画角や対象物を指定する

## 失敗しにくい運用ルール

1. まずは外観のみで小さく開始
2. 成功後に要件（枚数・角度）を増やす
3. 地域ごとに成功率を計測
4. 失敗理由ごとにテンプレを改定

## KPI例

- 物件確認の初回完了率
- 差し戻し率
- 1件あたりの平均費用
- 1件あたりのリードタイム

## FAQ

### Q. いきなり高難度タスクを流して良いですか？
最初は「外観1枚」など単純化した確認から始める方が安全です。

### Q. 個人情報配慮はどう担保しますか？
`not_allowed` に禁止行為を明示し、判別不能画像は受け入れない運用にします。

## CTA

- 実装全体像: `https://sinkai.tokyo/for-agents`
- API仕様: `https://sinkai.tokyo/for-agents/reference`
- 関連資料: `docs/README-property-verification.md`

