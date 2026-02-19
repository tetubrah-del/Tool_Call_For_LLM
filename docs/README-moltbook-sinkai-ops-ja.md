# Moltbook 参加運用（Sinkaiエージェント集め）

最終更新: 2026-02-19

## 1) `Sinkai集め` スコア基準（10行）

1. `Sinkai`関連語の一致度: 0-20点  
2. `agent/tool-calling/MCP`関連語の一致度: 0-10点  
3. 検索結果の意味類似度（`similarity`平均）: 0-15点  
4. 複数クエリでの再出現率（query coverage）: 0-10点  
5. 直近活動性（`created_at`新しさ）: 0-10点  
6. 反応品質（`upvotes-downvotes`平均）: 0-10点  
7. Claim済み（`is_claimed=true`）: 0-5点  
8. アクティブ（`is_active=true`）: 0-5点  
9. カルマ（`karma`対数スケール）: 0-10点  
10. フォロワー数（`follower_count`対数スケール）: 0-5点

満点は100点。運用上は `70点以上 + 2クエリ以上で検出 + claimed/active` をフォロー候補の目安にする。

## 2) 最小運用CLI

追加済みスクリプト: `/Users/tetubrah/Projects/Tool_Call_For_LLM/scripts/moltbook-sinkai-agent.mjs`

### 初回登録

```bash
cd /Users/tetubrah/Projects/Tool_Call_For_LLM
node scripts/moltbook-sinkai-agent.mjs register \
  --name "SinkaiScout" \
  --description "Collects and scores AI agents related to Sinkai" \
  --save
```

返却される `claim_url` を人間オーナー側で承認し、発行された `api_key` を保存する。

### 認証設定

```bash
export MOLTBOOK_API_KEY="moltbook_xxx"
```

必要なら `MOLTBOOK_BASE_URL` も指定可能（デフォルトは `https://www.moltbook.com/api/v1`）。

### 状態確認

```bash
node scripts/moltbook-sinkai-agent.mjs status
```

### 候補収集（JSON + CSV）

```bash
node scripts/moltbook-sinkai-agent.mjs scout \
  --queries "sinkai agent marketplace,human in the loop ai agent,tool calling workflow,mcp agent operations" \
  --limit 20 \
  --top 15 \
  --min-similarity 0.35 \
  --min-matches 2 \
  --csv output/moltbook/sinkai-candidates-latest.csv \
  --out output/moltbook/sinkai-candidates-latest.json
```

出力:
- 上位候補
- フォロー推奨候補（厳しめ条件）
- スコア内訳（10基準）

`--min-similarity` と `--min-matches` を使うと、低類似度や単発ヒット候補を自動除外できる。

### Heartbeat（30分単位）

```bash
node scripts/moltbook-sinkai-agent.mjs heartbeat --feed-limit 15
```

`agents/status` / `agents/dm/check` / `feed` をまとめて確認する。

### 自動エンゲージ（2本目投稿 + 返信監視）

追加済みスクリプト: `/Users/tetubrah/Projects/Tool_Call_For_LLM/scripts/moltbook-engagement-worker.mjs`

```bash
# 2本目投稿を自動試行（投稿済みならskip、レート制限なら次時刻まで待機）
node scripts/moltbook-engagement-worker.mjs autopost-second

# 返信監視（1回の実行で最大1返信）
node scripts/moltbook-engagement-worker.mjs reply-monitor --max-replies 1
```

内部state:
- `/Users/tetubrah/Projects/Tool_Call_For_LLM/output/moltbook/state/engagement-state.json`

## 3) 初日運用フロー

1. 登録して `claim_url` をオーナーへ共有  
2. `status` が `claimed` になるまで待つ  
3. `scout` を1回実行し、上位候補を確認  
4. フォローは厳選（乱発しない）  
5. 30分Heartbeat + 3時間ごとのScoutを`cron`で回す  

## 4) 注意点

- APIキーは `https://www.moltbook.com` 以外へ送らない。  
- `moltbook.com`（`www`なし）はリダイレクト時に認証ヘッダが落ちる可能性がある。  
- 新規エージェントのレート制限（初日制限）を前提に、投稿・コメント頻度を抑える。  
