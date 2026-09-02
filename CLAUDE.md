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

```bash
npm run dev              # Next dev server (turbopack)
npm run build            # prisma generate && next build
npm run lint             # next lint
npm run db:migrate       # prisma migrate dev
npm run db:push          # push schema without a migration
npm run db:studio        # Prisma Studio
npm run db:seed          # seed via prisma/seed.ts
npm run seed:demo        # demo dataset  (seed:demo:clear to wipe)
npm run sync             # one-off Odoo sync (scripts/run-sync-once.ts)
```

## Architecture

**Utilia** is a Next.js 15 App Router dashboard that syncs a business's Odoo instance into Postgres, then layers analytics, budgeting, and AI-generated marketing on top.

- **Stack:** Next.js (App Router, `src/`), Prisma + Postgres, NextAuth, Tailwind + shadcn/radix, Vercel.
- **AI:** Vercel AI SDK + OpenAI (`src/lib/ai/`) — powers `AIRecommendation` and campaign/status copy generation.

### Layout

```
src/app/(auth)/         # login flow
src/app/(dashboard)/    # authed app
src/app/api/            # route handlers
src/lib/odoo.ts         # Odoo client — the upstream source of truth
src/lib/sync.ts         # Odoo → Postgres sync orchestration
src/lib/snapshots.ts    # FinancialSnapshot rollups
src/lib/analytics/      # derived metrics
src/lib/ai/             # prompt construction + OpenAI calls
src/lib/period.ts       # fiscal period math
src/lib/timezone.ts     # all date handling goes through here
src/proxy.ts            # auth gate (antes middleware.ts)
```

### Data model (`prisma/schema.prisma`)

`User` (+`Role`) · `SyncState` · `ProductInsight` · `FinancialSnapshot` · `ExpenseBudget` · `Campaign` (+`CampaignStatus`, `CampaignTrigger`) · `CampaignExecution` · `CustomerSegment` · `Setting` · `AIRecommendation` · `PurchaseOrder` / `PurchaseOrderLine` · `StatusPost`

### Conventions

- Odoo is upstream. Never write back to Odoo from a sync path.
- Date/period math goes through `src/lib/period.ts` and `src/lib/timezone.ts` — do not inline `new Date()` arithmetic.
- `node-cron` drives scheduled sync; `scripts/run-sync-once.ts` is the manual equivalent.
- `npm run build` runs `prisma generate` first — a schema change requires a rebuild, not just a restart.
