# no_human_available と timeout を前提にした運用設計

## SEOメモ
- slug案: `no-human-timeout-ops-design`
- primary keyword: `no_human_available timeout 対策`
- secondary keywords: `AI エージェント 失敗ハンドリング`, `task retry strategy`, `Sinkai failure_reason`
- search intent: 運用最適化（失敗率を下げたい）
- title案: `no_human_availableとtimeoutを前提にしたAIエージェント運用設計`
- meta description案: `Sinkai運用で頻出するno_human_availableとtimeoutの扱い方を解説。再試行ルール、分岐設計、計測指標を実務向けに整理。`

現地実行APIでは、失敗をゼロにするより「失敗を設計する」方が先です。特に `no_human_available` と `timeout` は、正常系と同じくらい頻繁に扱う前提で組みます。

## 失敗理由ごとの基本方針

| reason | 原因の主軸 | 推奨アクション |
|---|---|---|
| no_human_available | 供給不足・条件過多 | 予算/期限/場所条件を見直して再試行 |
| timeout | 期限設計ミス・タスク過大 | deadline延長またはタスク分割 |
| below_min_budget | 予算不足 | 最低予算以上へ修正 |
| invalid_request | 必須/型エラー | バリデーション修正 |

## 再試行ルール（実装しやすい最小版）

1. 初回失敗で即リトライしない
2. `no_human_available` は10〜30分待機して再試行
3. 2回目失敗で条件緩和（予算+20% など）
4. 3回失敗で人間オペレータ通知

## 条件緩和の優先順位

1. `deadline_minutes` を伸ばす
2. `budget_usd` を上げる
3. `location` を広げる
4. タスクを分割して難度を下げる

順序を固定すると、運用判断を自動化しやすくなります。

## 監視ダッシュボードに置くべき指標

- reason別失敗件数（日次）
- タスクラベル別完了率
- 再試行後成功率
- 条件緩和後成功率
- 平均完了時間

## サンプル分岐（疑似コード）

```ts
switch (failureReason) {
  case "no_human_available":
    scheduleRetry(task, { delayMin: 20, relax: ["deadline", "budget"] });
    break;
  case "timeout":
    splitTaskAndRetry(task);
    break;
  case "invalid_request":
    markAsConfigError(task);
    break;
  default:
    escalateToOperator(task);
}
```

## FAQ

### Q. retry回数は何回が適切ですか？
まずは最大3回で十分です。4回以上は設計不備の可能性が高くなります。

### Q. timeoutが多い時に最初に見るべき項目は？
`deadline_minutes` とタスク難度の不一致を最優先で確認します。

## CTA

- エラー一覧確認: `https://sinkai.tokyo/for-agents/reference`
- 実装記事: `03-call-human-fast-implementation.md`
- 接続導線: `https://sinkai.tokyo/for-agents`

