# Moltbook 本番運用移行設計（Render REST API）

最終更新: 2026-02-19

## 1. 目的

- ローカル `crontab` 依存をやめ、Render上で 24/7 運用する。
- `2本目投稿` と `返信監視/返信` を自動化し、手動オペレーションを最小化する。
- 再起動・デプロイ後でも重複返信しないように state を永続化する。

## 2. 現状と課題

- 現状はローカル `crontab` で以下を実行中:
  - heartbeat
  - scout
  - autopost-second
  - reply-monitor
- `reply-monitor` の重複防止stateはファイル（`output/moltbook/state/engagement-state.json`）に保存。
- 本番で Cron Job を複数走らせる場合、ローカルファイルstate前提は壊れやすい（再起動や実行環境差分で整合性が崩れる）。

## 3. 推奨アーキテクチャ

### 3.1 構成

1. Render Web Service（既存アプリ。必要なら維持）
2. Render Cron Job: `sinkai-engagement-cycle`
   - `*/10 * * * *`
   - `node scripts/moltbook-engagement-worker.mjs run-cycle --max-replies 1`
   - 2本目投稿試行 + 返信監視を1ジョブに統合
3. Render Cron Job: `sinkai-heartbeat`
   - `*/30 * * * *`
   - `node scripts/moltbook-sinkai-agent.mjs heartbeat --feed-limit 15`
4. Render Cron Job: `sinkai-scout-3h`
   - `15 */3 * * *`
   - `node scripts/moltbook-sinkai-agent.mjs scout --limit 20 --top 15 --min-similarity 0.35 --min-matches 2 --out ... --csv ...`
5. Render Cron Job: `sinkai-scout-daily`
   - `10 0 * * *`（JST 09:10 相当）
   - `node scripts/moltbook-sinkai-agent.mjs scout --limit 20 --top 20 --min-similarity 0.35 --min-matches 2 --csv true`
6. Render Postgres（既存を流用）
   - engagement state と重複防止履歴を保存

### 3.2 永続state設計（重要）

`moltbook-engagement-worker.mjs` の state 保存先をファイルからDBへ移行する。

テーブル案:

```sql
CREATE TABLE IF NOT EXISTS moltbook_engagement_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  second_post_status TEXT NOT NULL DEFAULT 'pending',
  second_post_id TEXT,
  second_post_last_attempt_at TIMESTAMPTZ,
  second_post_next_earliest_at TIMESTAMPTZ,
  watch_post_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moltbook_handled_comment_events (
  source_comment_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  handled_action TEXT NOT NULL, -- replied | replied_to_reply | skipped
  reply_comment_id TEXT,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

実装ルール:

- 返信前に `source_comment_id` の存在を確認（存在したらskip）
- 返信成功後、同一トランザクションで `moltbook_handled_comment_events` に書き込み
- これで再実行・再起動時も重複返信を防止

## 4. 環境変数

必須:

- `MOLTBOOK_API_KEY`（Render Secret）
- `MOLTBOOK_BASE_URL=https://www.moltbook.com/api/v1`
- `DATABASE_URL`（Render Postgres接続）
- `PGSSLMODE=require`

任意:

- `MOLTBOOK_WATCH_POST_IDS`（固定監視対象を追加する場合）
- `MOLTBOOK_REPLY_MAX_PER_RUN=1`

## 5. セキュリティ設計

- APIキーは Render Secret で管理（`render.yaml` は `sync: false`）。
- ログにAPIキーを出さない（現在のスクリプトはヘッダを出力しない設計）。
- `www.moltbook.com` 固定を維持（非`www`はリダイレクト時に認証ヘッダが落ちうる）。
- 失敗時は再試行するが、同一イベント重複返信は禁止（DB制約で担保）。

## 6. 監視・運用

- Render Cron run status 監視（失敗通知を有効化）。
- ログ監視対象:
  - `autopost_second.action`
  - `reply_monitor.replies_sent`
  - `rate_limited` の頻度
- 目標:
  - 返信ジョブ失敗率 < 1%
  - 重複返信 0件
  - 2本目投稿はレート制限解除後1実行以内に成功

## 7. 移行ステップ（MCPを使わずAPIで実施）

1. Render APIキーを設定:
   - `export RENDER_API_KEY=...`
2. owner ID を取得:
   - `curl -sS -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/owners`
3. Postgres準備（既存利用 or 新規）
4. worker state のDB化実装
5. `scripts/render-moltbook-cron-api.mjs` で plan/apply
6. 本番切替（ローカル crontab 停止）
7. 24時間監視後にジョブ数最適化（heartbeat統合可否を判断）

## 8. ロールバック

- Cron Job を一時停止し、ローカル `crontab` に戻す。
- DB state は保持し、復旧時に再利用。
- `reply-monitor` のみ停止して `scout/heartbeat` 継続、の部分ロールバックを許容。

## 9. 補足（Render運用上の前提）

- Render Cron は cron式でスケジュールされる（時刻はUTC運用）。
- 次回実行時刻が到来しても前回実行が終わっていなければ、その実行はスキップされる（重複起動しない）。

## 10. 実行コマンド（REST API）

```bash
cd /Users/tetubrah/Projects/Tool_Call_For_LLM
export RENDER_API_KEY="rnd_xxx"

# 差分確認（作成/再作成の予定のみ表示）
npm run render:moltbook:cron -- plan --env-file .env.local

# 適用（差分があるjobは delete + recreate）
npm run render:moltbook:cron -- apply --env-file .env.local --replace-changed
```

補足:
- この運用は Render MCP を使わない。
- `--env-file .env.local` から `MOLTBOOK_API_KEY` を読み込む。
- `MOLTBOOK_API_KEY` は plan 出力で伏字化される。

参照:
- Render Cron Jobs: https://render.com/docs/cronjobs
- Render Blueprint Spec: https://render.com/docs/blueprint-spec
