# Next 16 Upgrade PR Plan (Staged)

## Scope
- Target: `next` を `^16.1.6` へ更新（現状 `^14.2.35`）
- Strategy: **2段階PR**（低リスクのセキュリティ解消を先行し、メジャー移行を分離）

## Current Snapshot
- Node: `v22.21.1`（`next@16` の `>=20.9.0` を満たす）
- npm: `10.9.4`
- Current deps:
  - `next: ^14.2.35`
  - `react/react-dom: 18.3.1`
  - `next-auth: ^4.24.13`（`^16` 互換レンジ）
- `npm audit --omit=dev`: high 1件（`next` 起因）

## Dependency Compatibility (checked)
- `next@16.1.6` peer:
  - `react`: `^18.2.0 || ^19.0.0`
  - `react-dom`: `^18.2.0 || ^19.0.0`
- `eslint-config-next@16.1.6` peer:
  - `eslint >=9.0.0`（現状 `eslint@8` なので更新必須）
- `next-auth@4.24.13` peer:
  - `next ^12 || ^13 || ^14 || ^15 || ^16`（互換）

---

## PR-1 (Risk-down / Security Backport)

### Goal
- `next` の監査リスクを早期低減しつつ、メジャー破壊を避ける。

### Changes
- `next` を backport ラインへ更新: `15.5.12`
- `eslint-config-next` を `15.5.12` に揃える
- `npm run lint` / `npm run build` / 主要フロー手動確認

### Why first
- 監査上の既知脆弱性を先に解消し、サービス露出期間を短縮。
- 16移行の純粋な破壊対応を次PRに分離できる。

### Acceptance
- `npm audit --omit=dev` で `next` 高リスクが解消されること
- build/lint成功
- 主要APIと主要UIフローが現行同等で動くこと

### Rollback condition
- build不可 or 主要API互換崩れ（`/api/tasks`, `/api/call_human`, `/api/submissions`, `/api/tasks/:id/approve`）

---

## PR-2 (Major Upgrade to Next 16)

### Goal
- `next` 本体を `16.1.6` に更新し、将来の保守性とセキュリティ追従性を確保。

### Planned Changes
1. Dependencies
- `next -> ^16.1.6`
- `eslint-config-next -> ^16.1.6`
- `eslint -> ^9`
- 必要に応じて ESLint 設定を新仕様へ調整

2. Codemod baseline
- `npx @next/codemod@latest upgrade latest`
- 差分を最小化するため、生成差分のうち不要変更は戻す

3. Type/API breaking checks
- Route Handler の `params` / page `searchParams` 型影響確認
- `next.config.js` の互換性確認
- `next lint` の実行ルート（eslint9）確認

4. Runtime verification
- `npm run build`
- `npm run start` で主要画面表示確認
- Playwright smoke（既存3ケース）実行

### Known likely impact points in this repo
- 動的 route handler が多数（`app/api/**/[id]/route.ts`）
- `searchParams` を直接型指定している server page:
  - `app/(human)/register/page.tsx`
  - `app/(human)/me/page.tsx`
  - `app/profile/[humanId]/page.tsx`
- これらは codemod か手修正で吸収可能性あり

### Acceptance
- lint/build 全通
- 既存 smoke 通過
- 主要APIの互換レスポンス維持
- `npm audit --omit=dev` で `next` 由来の high が再発しない

### Rollback condition
- 互換崩れが複数エンドポイントで発生
- `eslint9` 移行に伴う大規模Lint崩壊が発生

---

## Validation Matrix (each PR)
- API
  - `POST /api/call_human`
  - `POST /api/tasks`
  - `POST /api/submissions`
  - `POST /api/tasks/:taskId/approve`
  - `GET /api/me/payments`
- UI
  - `/tasks`（mobile filter toggle）
  - タスクカード `詳細を見る` クリック遷移
  - `/auth?next=...` ログイン後復帰導線
- Admin
  - `/manage` 参照
  - `/api/admin/*` 認可境界

---

## Execution Order
1. PR-1 を先に実施（低リスクで監査リスクを先に下げる）
2. PR-2 で Next 16 + ESLint 9 に進む
3. 各PRで Render deploy 前に `build + smoke` を必須化

