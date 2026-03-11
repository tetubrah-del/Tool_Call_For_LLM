# Koyuki Keiba v2

Koyuki v2 は `server-only` 前提で、`koyuki_keiba_v2` 専用の persona/campaign を API 経由で強制します。

現在の推奨運用は `Codex手動下書き + API登録 + dispatch cron` です。自動 planner は残っていますが、投稿本文の生成元としては使わず、必要なら停止してください。

## 追加したもの

- `POST /api/marketing/dispatch`
  - JST スロット判定
  - 1回の実行で最大1件だけ publish queue へ投入
  - `daily_cap` / `min_interval` / `slot already handled` をガード
- `POST /api/marketing/contents`
  - `campaign_id`, `persona_id`, `content_type`, `slot_key`, `planned_for` を保存
  - `APP_CAMPAIGN_ID`, `APP_PERSONA_ID`, `POST_SOURCE_WHITELIST` による拒否
- `POST /api/marketing/publish`
  - persona/campaign/source whitelist を再検証
  - source link の疎通確認をしてから queue 化
- `POST /api/marketing/planner`
  - 翌日分 10 本の下書きを mix 配分で一括生成
  - persona spec を prompt に埋め込み、slot ごとに `marketing_contents` へ保存
- `scripts/koyuki-keiba-dispatch-cron.mjs`
  - Render Cron から `/api/marketing/dispatch` を叩くワンショット用
- `scripts/koyuki-keiba-planner-cron.mjs`
  - Render Cron から `/api/marketing/planner` を叩くワンショット用
- `scripts/koyuki-keiba-manual-seed.mjs`
  - Codex が作った JSON 下書きを `/api/marketing/contents` へ一括登録
  - 同じ `planned_for + slot_key` が既にある場合は安全側で停止

## 必須 env

API:

```env
APP_PERSONA_ID=koyuki_keiba_v2
APP_CAMPAIGN_ID=koyuki_keiba_v2
POST_SOURCE_WHITELIST=netkeiba.com,jra.go.jp,nankankeiba.com,keibalab.jp
MARKETING_AUTONOMOUS_TIMEZONE=Asia/Tokyo
MARKETING_AUTONOMOUS_DAILY_POST_LIMIT=10
MARKETING_AUTONOMOUS_MIN_INTERVAL_MINUTES=45
MARKETING_AUTONOMOUS_SLOTS=07:30,09:00,10:30,12:00,13:30,15:00,16:30,18:00,20:00,22:00
MARKETING_AUTONOMOUS_SLOT_WINDOW_MINUTES=5
```

- `MARKETING_API_KEY`
  - Render の secret env に設定する

Dispatch cron:

```env
KOYUKI_KEIBA_API_BASE_URL=https://<koyuki-keiba-api>
```

- `MARKETING_API_KEY`
  - API と同じ値を Render の cron secret env に設定する

## content 登録例

```json
{
  "brief_id": "koyuki-keiba-v2-manual",
  "channel": "x",
  "format": "text",
  "campaign_id": "koyuki_keiba_v2",
  "persona_id": "koyuki_keiba_v2",
  "content_type": "race_prediction",
  "slot_key": "0730",
  "planned_for": "2026-03-12",
  "title": "阪神11R 朝の注目メモ",
  "body_text": "今日は馬場傾向から先行勢を少し上に見たいです。",
  "source_url": "https://race.netkeiba.com/...",
  "source_domain": "netkeiba.com"
}
```

## Codex 手動運用

1. Codex が 1 日分または 3 日分の fact-grounded 下書きを作る
2. JSON に保存する
3. `npm run marketing:koyuki-manual-seed -- docs/koyuki-keiba-manual-drafts.example.json --dry-run`
4. 問題なければ `npm run marketing:koyuki-manual-seed -- <drafts.json>`
5. Render の `dispatch` cron が各 slot で publish queue に 1 件ずつ積む

下書き JSON 例:
- [koyuki-keiba-manual-drafts.example.json](/Users/tetubrah/Projects/Tool_Call_For_LLM/docs/koyuki-keiba-manual-drafts.example.json)

## Render Cron

- ingest: `0 * * * *`
- dispatch: `*/15 * * * *`
- optional planner: `5 7,13 * * *`
- command: `npm run marketing:koyuki-dispatch-cron`

## 運用メモ

- `slot_key` は `HHMM` 固定です。例: `07:30 -> 0730`
- `planned_for` は JST の `YYYY-MM-DD`
- キャラ設定が未定でも、まずは `persona_id/campaign_id` を `koyuki_keiba_v2` で固定して運用分離できます
- キャラ仕様の叩き台は [SPEC-koyuki-keiba-persona-v2-ja.md](/Users/tetubrah/Projects/Tool_Call_For_LLM/docs/SPEC-koyuki-keiba-persona-v2-ja.md) を参照
- planner は既存 slot が埋まっている日は `planner_already_seeded` でスキップします
- 手動運用に切り替えるなら `koyuki-keiba-planner-cron` は止めるのが安全です
