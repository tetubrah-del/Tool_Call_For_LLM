# Koyuki Keiba v2

Koyuki v2 は `server-only` 前提で、`koyuki_keiba_v2` 専用の persona/campaign を API 経由で強制します。

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
- `scripts/koyuki-keiba-dispatch-cron.mjs`
  - Render Cron から `/api/marketing/dispatch` を叩くワンショット用

## 必須 env

API:

```env
MARKETING_API_KEY=...
APP_PERSONA_ID=koyuki_keiba_v2
APP_CAMPAIGN_ID=koyuki_keiba_v2
POST_SOURCE_WHITELIST=netkeiba.com,jra.go.jp,nankankeiba.com,keibalab.jp
MARKETING_AUTONOMOUS_TIMEZONE=Asia/Tokyo
MARKETING_AUTONOMOUS_DAILY_POST_LIMIT=10
MARKETING_AUTONOMOUS_MIN_INTERVAL_MINUTES=45
MARKETING_AUTONOMOUS_SLOTS=07:30,09:00,10:30,12:00,13:30,15:00,16:30,18:00,20:00,22:00
MARKETING_AUTONOMOUS_SLOT_WINDOW_MINUTES=5
```

Dispatch cron:

```env
KOYUKI_KEIBA_API_BASE_URL=https://<koyuki-keiba-api>
MARKETING_API_KEY=...
```

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

## Render Cron

- ingest: `0 * * * *`
- dispatch: `*/15 * * * *`
- command: `npm run marketing:koyuki-dispatch-cron`

## 運用メモ

- `slot_key` は `HHMM` 固定です。例: `07:30 -> 0730`
- `planned_for` は JST の `YYYY-MM-DD`
- キャラ設定が未定でも、まずは `persona_id/campaign_id` を `koyuki_keiba_v2` で固定して運用分離できます
