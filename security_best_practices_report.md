# Security Best Practices Report (Pre-Launch, Updated)

## Executive Summary
今回の対応で、事前診断の主要リスクのうち **5件を最小差分で是正**しました。現時点の残課題は、
- `next` メジャー更新が必要な既知脆弱性（高）
- アップロード保存先が `public/` 配下（中）
の2点です。

---

## Resolved in This Patch

### [SBP-001] Public PII Exposure via `/api/humans`（対応済み）
- Updated: `app/api/humans/route.ts`
- Change:
  - `GET /api/humans` を `SELECT *` から公開許容フィールドの allowlist 返却へ変更。
  - `email`, `paypal_email`, `min_budget_usd` などの機微データを返さないよう修正。

### [SBP-002] Webhook Dispatch SSRF / DNS Rebinding Window（対応済み）
- Updated: `lib/webhooks.ts`
- Change:
  - 配信時 `fetch` の直前に送信先URLを再検証（https限定 + private IP/localhost拒否 + DNS再解決）。
  - 再検証失敗時は `webhook_deliveries` に `webhook_url_revalidation_failed` を記録して送信中止。

### [SBP-004] CSRF Hardening Gap on Cookie Session POST（対応済み）
- Updated: `lib/same-origin.ts`, `lib/admin-auth.ts`, `app/api/profile/route.ts`, `app/api/humans/route.ts`
- Change:
  - 共通 same-origin 判定ユーティリティを追加。
  - `POST /api/profile` と `POST /api/humans` に同一オリジン検証を追加。

### [SBP-005] Test Auth Path in Production（対応済み）
- Updated: `app/api/tasks/[taskId]/contact/_auth.ts`, `app/api/submissions/route.ts`, `app/api/tasks/[taskId]/apply/route.ts`
- Change:
  - `verifyTestHumanToken` で `NODE_ENV=production` 時は常に無効化。

### [SBP-007] Missing CSP Header（対応済み）
- Updated: `next.config.js`
- Change:
  - `Content-Security-Policy` を追加（baseline policy）。

### Dependency Partial Fix（対応済み）
- Updated: `package.json`, `package-lock.json`
- Change:
  - `next-auth` を安全側へ更新（監査上の `next-auth` 指摘を解消）。

---

## Remaining Risks

### [SBP-003] `next` Advisory Requires Major Upgrade
- Severity: High
- Location: `package.json` (`next@14.2.35`)
- Evidence:
  - `npm audit --omit=dev` で `next` 高リスク1件が継続。
  - 修正候補は `next@16.1.6`（メジャー更新）。
- Recommendation:
  - 別PRで `next` メジャーアップグレード計画（互換性確認付き）を実施。
  - 併せて staging で E2E 回帰テストを実施。

### [SBP-006] Upload Storage under `public/`
- Severity: Medium
- Location: `lib/storage.ts`
- Evidence:
  - 保存先が `public/uploads`。
- Recommendation:
  - 次PRで保存先を web root 外へ移し、配信を認可付き route / 署名URL化。

---

## Verification
- `npm run lint`: pass
- `npm audit --omit=dev`: high=1（`next` のみ残）

