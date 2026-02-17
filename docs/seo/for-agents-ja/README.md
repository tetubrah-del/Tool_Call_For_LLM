# Sinkai SEO記事セット（for Agents向け）

このフォルダは、`sinkai.tokyo` の for Agents 導線を強化するための記事ドラフトです。

## 収録記事

1. `01-onsite-verification-api-intro.md`
2. `02-mcp-quickstart.md`
3. `03-call-human-fast-implementation.md`
4. `04-no-human-timeout-ops.md`
5. `05-real-estate-template.md`
6. `06-jp-local-research-workflow.md`

## 公開順（推奨）

1. 01（概念・導入判断）
2. 02（最短接続）
3. 03（実装詳細）
4. 04（運用設計）
5. 05（業界ユースケース: 不動産）
6. 06（業界ユースケース: 日本語調査）

## 内部リンク設計

- 全記事の冒頭または末尾で以下をリンク:
  - `https://sinkai.tokyo/for-agents`
  - `https://sinkai.tokyo/for-agents/quickstart`
  - `https://sinkai.tokyo/for-agents/reference`
  - `https://sinkai.tokyo/openapi.json`
- 01 -> 02,03 へリンク
- 03 -> 04,05 へリンク
- 05 -> 06 へリンク

## 使い方

- 先頭の `SEOメモ` を CMS の title/description/slug 設定に転記
- 本文のコード例は最新版 API に合わせて最終確認
- CTA は主CTA1つ、副CTA1つに絞って離脱を防止
