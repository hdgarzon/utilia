# CLAUDE.md

Guidance for Claude when working in this repository.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" in: commit messages, branch names, PR titles, PR descriptions, issue titles or comments, release notes, changelog entries, or code comments.
- Write every commit as the repo author would. Imperative subject, `scope(area): resumen` prefix, no emoji, no filler.
- **Commit language: Spanish**, unaccented, matching existing history (`feat(estados): plantilla gancho de intriga`).

Exception: naming Claude/OpenAI as a *product dependency* is fine when it is factually part of the system — a model ID string, `@ai-sdk/openai` in `package.json`, a doc explaining the AI recommendation feature. The ban is on attribution, not on the API.

## Sensitive data — never commit

Treat this repo as if it were public.

**Never stage:**
- `.env`, `.env.local`, `.env.production.local` or any variant except `.env.example`.
- Odoo credentials or endpoint URLs, OpenAI API keys, `NEXTAUTH_SECRET`, database connection strings with a password.
- Production dumps, or seed/fixture files containing real customer names, emails, phones, or addresses.
- Exports from production (CSV, JSON, XLSX), screenshots showing real records, or logs with real payloads.
- Internal docs naming real customers, real suppliers, real margins, or contract prices.

**Domain-specific for Utilia:** `CustomerSegment`, `FinancialSnapshot`, `PurchaseOrder` and the Odoo sync all carry real commercial data. Never paste real segment exports, real revenue figures, or real supplier pricing into `docs/`. `scripts/export-odoo-products.ts` output is production data — it does not belong in the repo.

**Prisma:** schema, migrations and enums are fine. `prisma/seed.ts` must use obviously fake data. Never hardcode a connection string.

**Rules of thumb:**
- Every example value must be obviously fake: `user@example.com`, `sk_test_xxx`, `Cliente Demo`, `+10000000000`.
- If a doc needs a real payload to be useful, keep the shape and redact the values.
- Never run `git add -A` or `git add .`. Stage explicit paths so nothing rides along.
- If unsure whether a file is sensitive, do not stage it — ask first.

## Commands

pnpm 12 (pinned via `packageManager`) on Node 22 (`.nvmrc`). Scripts that reach Odoo or the database load `.env.local` through `tsx --env-file`.

```bash
pnpm dev                 # Next dev server (turbopack)
pnpm build               # prisma generate && next build
pnpm lint                # eslint src
pnpm test                # vitest run  (test:watch for watch mode)
pnpm db:migrate          # prisma migrate dev
pnpm db:push             # push schema without a migration
pnpm db:studio           # Prisma Studio
pnpm db:seed             # seed via prisma/seed.ts
pnpm seed:demo           # demo dataset  (seed:demo:clear to wipe)
pnpm sync                # one-off Odoo sync (scripts/run-sync-once.ts)
pnpm backfill            # rebuild sales history from Odoo (scripts/backfill-history.ts)
```

## Architecture

**Utilia** is a Next.js 16 App Router dashboard that syncs a business's Odoo instance into Postgres, then layers analytics, budgeting, replenishment, and AI-generated marketing on top.

- **Stack:** Next.js 16 (App Router, `src/`), Prisma 6 + Postgres (Supabase), NextAuth v5, Tailwind 4 + shadcn/radix, Vitest, Vercel.
- **AI:** Vercel AI SDK + OpenAI (`src/lib/ai/`) — powers `AIRecommendation` and campaign/status copy generation.

### Layout

```
src/app/(auth)/         # login flow
src/app/(dashboard)/    # authed app
src/app/api/            # route handlers
src/lib/odoo.ts         # Odoo client — the upstream source of truth
src/lib/odoo-write.ts   # purchase-order drafts in Odoo, user-triggered only
src/lib/products/       # bulk product import (writes catalog to Odoo)
src/lib/suppliers.ts    # supplier directory, seeded from purchase history and Odoo
src/lib/whatsapp.ts     # supplier order message + wa.me link (no network calls)
src/lib/cron-auth.ts    # Vercel Cron secret check
src/lib/sync.ts         # Odoo → Postgres sync orchestration
src/lib/snapshots.ts    # FinancialSnapshot rollups
src/lib/analytics/      # derived metrics
src/lib/ai/             # prompt construction + OpenAI calls
src/lib/period.ts       # fiscal period math
src/lib/timezone.ts     # all date handling goes through here
src/proxy.ts            # auth gate (antes middleware.ts)
```

### Data model (`prisma/schema.prisma`)

`User` (+`Role`) · `SyncState` · `ProductInsight` · `FinancialSnapshot` · `CategorySnapshot` · `ExpenseBudget` · `Campaign` (+`CampaignStatus`, `CampaignTrigger`) · `CampaignExecution` · `CustomerSegment` · `Setting` · `AIRecommendation` · `PurchaseOrder` / `PurchaseOrderLine` · `StatusPost` · `Supplier` (+`ProductSupplierOverride`) · `ReplenishmentOrder` / `ReplenishmentLine` (+`ReplenishmentStatus`) · `ProductImportBatch` / `ProductImportRow` (+`ProductImportStatus`, `ProductImportRowStatus`)

### Conventions

- Odoo is upstream. Never write back to Odoo from a sync path. Writes happen only from user-triggered actions, through `src/lib/odoo-write.ts` (purchase-order drafts) and `src/lib/products/odoo-catalog-write.ts` (catalog import).
- Date/period math goes through `src/lib/period.ts` and `src/lib/timezone.ts` — do not inline `new Date()` arithmetic.
- Scheduled sync runs on Vercel Cron (`vercel.json`, daily at 10:00 UTC), which calls `GET /api/sync` signed with `CRON_SECRET`; `pnpm sync` is the manual equivalent. `node-cron` is still listed in `package.json`, but nothing imports it.
- `pnpm build` runs `prisma generate` first — a schema change requires a rebuild, not just a restart.
