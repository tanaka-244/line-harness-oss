# CLAUDE.md — たなか整骨院 LINE Harness

## 必ず確認してから実行すること

以下の操作は実行前にユーザーに内容を伝え、承認を得てから行う。

- **デプロイ操作** — `wrangler deploy`、`wrangler pages deploy` など本番環境への反映
- **APIキー・シークレット・環境変数の変更・削除** — `wrangler secret put/delete`、GitHub Secrets の変更
- **データベースのデータ削除** — `DROP TABLE`、`DELETE FROM`、`wrangler d1 execute` でのスキーマ変更
- **課金が発生しそうな操作** — R2への大量アップロード、Cloudflare有料機能の有効化、新規リソース作成
- **GitHubのシークレット変更** — リポジトリ設定の変更、Actions の secrets/variables 操作

## 確認なしで進めてOK

- ファイルの修正・追加
- ビルド・TypeScriptチェック（`tsc --noEmit`、`next build` など）
- `git add`・`git commit`・`git push`
- 通常のバグ修正・機能追加

## プロジェクト概要

たなか整骨院の LINE 公式アカウント CRM。Cloudflare Workers + D1 + R2 で動作。

```
Worker:    https://line-harness.t-244-0108.workers.dev
管理画面:  https://line-harness-web-2mb.pages.dev
DB:        line-crm (D1: 07b0072c-b721-4135-bb22-c3cb1bed4abe)
R2:        line-harness-images
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API / Webhook | Cloudflare Workers + Hono |
| DB | Cloudflare D1 (SQLite) |
| 管理画面 | Next.js 15 (静的エクスポート) → Cloudflare Pages |
| SDK | TypeScript (packages/line-sdk) |
| CI/CD | GitHub Actions → 自動デプロイ (main ブランチ) |

## デプロイ手順

```bash
# Worker（手動）
cd apps/worker && npx vite build && npx wrangler deploy

# 管理画面（手動）
cd apps/web && npx next build
npx wrangler pages deploy out --project-name=line-harness-web --commit-dirty=true

# GitHub Actions（git push で自動）
# - apps/worker/** 変更 → Worker 自動デプロイ
# - apps/web/**    変更 → Pages 自動デプロイ
```

## ウェルカムシナリオ

- シナリオID: `ff65b717-e2ce-4828-9587-e99329de4873`
- トリガー: 友だち追加 (`friend_add`)
- 配信: 5分ごとの Cron で `processStepDeliveries` が実行
