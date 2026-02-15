# Security Best Practices Report

## Executive Summary
この監査では、Next.js/TypeScript アプリの主要APIルートと認証・Webhook・アップロード処理を対象に確認しました。**重大度 Critical 1件、High 4件、Medium 1件**の改善事項を確認しています。特に、`/api/ai/accounts` で既存アカウントの `api_key` を再取得できる実装は、メールアドレス既知だけでAPIキー窃取につながるため、最優先での対処が必要です。

---

## Critical

### [SBP-001] 既存AIアカウントの API キー再取得によるアカウント乗っ取り
- Severity: Critical
- Location: `app/api/ai/accounts/route.ts:25`, `app/api/ai/accounts/route.ts:33`, `app/api/ai/accounts/route.ts:45`
- Evidence:
```ts
const existing = await db.prepare(
  `SELECT * FROM ai_accounts WHERE paypal_email = ? ...`
).get(paypalEmail);
...
return NextResponse.json({
  status: "connected",
  account_id: existing.id,
  api_key: existing.api_key
});
```
- Impact: 攻撃者は既知の運用メール（`paypal_email`）を指定して既存アカウントの `api_key` を取得し、タスク作成・承認・Webhook操作などを不正実行できます。
- Fix:
  1. 既存アカウント検出時に `api_key` を返さない。
  2. 所有確認（メールOTP/マジックリンク/OAuthログイン）後のみ再発行フローを許可。
  3. APIキー表示は「新規発行直後の一度だけ」に限定し、再表示不可にする。
- Mitigation: 一時対応として、既存 `api_key` の返却を即時無効化し、再発行エンドポイントを別管理者フローに分離。
- False positive notes: 実装上、追加認証は確認できませんでした。

---

## High

### [SBP-002] URL クエリで API キー/トークンを受け取っている
- Severity: High
- Location:
  - `app/api/ai/accounts/route.ts:68`
  - `app/api/webhooks/route.ts:73`
  - `app/api/ai/reviews/summary/route.ts:11`
  - `app/api/tasks/[taskId]/contact/messages/route.ts:79`
  - `app/api/tasks/[taskId]/contact/_auth.ts:75`
- Evidence:
```ts
const aiApiKey = url.searchParams.get("api_key");
const qAiKey = (url.searchParams.get("ai_api_key") || "").trim();
const qHumanToken = (url.searchParams.get("human_test_token") || "").trim();
```
- Impact: 認証情報がブラウザ履歴、アクセスログ、監視ツール、リファラ等に漏洩しやすく、資格情報漏えいの主要因になります。
- Fix:
  1. 機密情報は `Authorization: Bearer ...` または POST body のみに限定。
  2. クエリ認証は段階的に廃止し、移行期間後に 400/401 を返す。
  3. 既存ログのマスキング/削除ポリシーを実施。
- Mitigation: 直ちに `api_key`/`ai_api_key`/`human_test_token` をURLから受け付けないガードを追加。
- False positive notes: 参照先コードでクエリ経由を明示的に許可しています。

### [SBP-003] AI API キーを平文保存・平文比較している
- Severity: High
- Location: `app/api/ai/accounts/route.ts:54`, `lib/ai-api-auth.ts:113`, `lib/ai-api-auth.ts:119`
- Evidence:
```ts
INSERT INTO ai_accounts (..., api_key, ...) VALUES (..., ?, ...)
...
if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active")
```
- Impact: DBダンプ/内部参照漏えい時に全AIアカウントの即時な不正利用につながります。
- Fix:
  1. APIキーは `prefix + secret` 形式で発行し、DBには `sha256(pepper + secret)` のみ保存。
  2. 検証はハッシュ比較（可能なら timing-safe）。
  3. 既存キーは段階移行（再発行 or 初回利用時再ハッシュ）。
- Mitigation: 少なくともDBアクセス権を最小化し、監査ログを強化。
- False positive notes: `human_api_keys` はハッシュ化方針ですが、`ai_accounts.api_key` は未適用です。

### [SBP-004] Webhook URL バリデーション不足による SSRF リスク
- Severity: High
- Location: `app/api/webhooks/route.ts:23`, `app/api/webhooks/route.ts:26`, `lib/webhooks.ts:74`
- Evidence:
```ts
return parsed.protocol === "https:" || parsed.protocol === "http:";
...
const response = await fetch(endpoint.url, { method: "POST", ... })
```
- Impact: 内部ネットワーク/メタデータエンドポイントへサーバ側からリクエスト送信される可能性があります（SSRF）。
- Fix:
  1. `https` のみ許可（本番）。
  2. `localhost`、`127.0.0.0/8`、`169.254.0.0/16`、RFC1918、link-local 等を拒否。
  3. DNS再解決/リダイレクト先も同様に検証。
- Mitigation: 送信先アウトバウンド通信をFW/egressで制限。
- False positive notes: 現状はホスト制限がありません。

### [SBP-005] 公開配下へのアップロードで型検証が不十分
- Severity: High
- Location: `app/api/submissions/route.ts:169`, `app/api/submissions/route.ts:175`, `lib/storage.ts:5`, `lib/storage.ts:14`
- Evidence:
```ts
if (type === "text") {
  if (file) {
    if (!file.type.startsWith("image/")) ...
  }
} else {
  if (!file) ...
  contentUrl = await saveUpload(file); // photo/video でMIME制約なし
}
```
- Impact: 任意ファイルが `public/uploads` に配置され、悪性コンテンツ配布・意図しない実行コンテキストへの誘導に悪用される可能性があります。
- Fix:
  1. `photo`/`video`ごとにMIMEと拡張子の allowlist を実施。
  2. 可能なら再エンコード（画像/動画変換）で危険形式を除去。
  3. 公開ディレクトリではなく非公開ストレージ + 署名URL配信へ移行。
- Mitigation: 短期対応で `image/jpeg|png|webp`、`video/mp4|webm` のみ許可。
- False positive notes: 保存先は静的公開 (`/public/uploads`) であることをコードで確認しました。

---

## Medium

### [SBP-006] アプリコード上でセキュリティヘッダの明示設定が見当たらない
- Severity: Medium
- Location: `next.config.js:2`
- Evidence:
```js
const nextConfig = {
  reactStrictMode: false
};
```
- Impact: CSP、`X-Content-Type-Options`、`Referrer-Policy` 等の防御層が未設定だと、他の不備発生時の被害抑止が弱くなります。
- Fix:
  1. `next.config.js` の `headers()` で最低限のセキュリティヘッダを設定。
  2. 既存機能に合わせた CSP を段階導入。
- Mitigation: 既にCDN/WAFで設定済みなら、構成管理上のエビデンスを残す。
- False positive notes: エッジ側設定はコードからは確認不能のため要ランタイム検証。

---

## Scope / Method
- 対象: Next.js App Router API (`app/api/**`), 認証/認可ロジック (`lib/**`), アップロード/Webhook 周辺。
- 参照基準:
  - `javascript-typescript-nextjs-web-server-security.md`
  - `javascript-typescript-react-web-frontend-security.md`
