# CLAUDE.md

Guidance for Claude when working in this repository.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" in: commit messages, branch names, PR titles, PR descriptions, issue titles or comments, release notes, changelog entries, or code comments.
- Write every commit as the repo author would. Imperative subject, `scope(area): resumen` prefix, no emoji, no filler.
- **Commit language: Spanish**, unaccented, matching existing history (`feat(estados): plantilla gancho de intriga`).

Exception: naming Claude/OpenAI as a *product dependency* is fine when it is factually part of the system — a model ID string, `@ai-sdk/anthropic` in `package.json`, a doc explaining the AI recommendation feature. The ban is on attribution, not on the API.

## Sensitive data — never commit

Treat this repo as if it were public.

**Never stage:**
- `.env`, `.env.local`, `.env.production.local` or any variant except `.env.example`.
- Odoo credentials or endpoint URLs, Anthropic or OpenAI API keys, `NEXTAUTH_SECRET`, database connection strings with a password.
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

- **Stack:** Next.js 16 (App Router, `src/`), Prisma 7 (driver adapter `pg`) + Postgres (Supabase), NextAuth v5, Tailwind 4 + shadcn/radix, Vitest, Vercel.
- **AI:** Vercel AI SDK + Anthropic (`src/lib/ai/`, model in `src/lib/ai/model.ts`, key `ANTHROPIC_API_KEY`) — powers `AIRecommendation`, status copy and product SEO text.

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
src/lib/fixed-expenses.ts # monthly fixed cost from budgets (inherits the last month that has one)
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
- Monthly P&L (Centro Financiero, home "¿Ganamos?") comes from `src/lib/analytics/financial-month.ts`: fixed cost is charged per calendar day from the budget, and only days closed by the last sync count. Do not sum `FinancialSnapshot.fixedExpenses`/`netProfit` for monthly figures — those columns skip days without sales.
- Dead stock has one definition: `DEAD_STOCK_DAYS` (30) days without a sale, read from `ProductInsight.rotationDays`, which the sync recomputes for the whole catalog. The no-reorder rule is `NO_REORDER_DAYS` (45). Both live in `src/lib/analytics/dead-stock.ts`.
- `backfillSalesHistory` cuts months at Colombia midnight (05:00 UTC). Cutting at UTC midnight overwrote each month's last day with only its 7pm-midnight sales.
- Scheduled sync runs on Vercel Cron (`vercel.json`, daily at 10:00 UTC), which calls `GET /api/sync` signed with `CRON_SECRET`; `pnpm sync` is the manual equivalent.
- `pnpm build` runs `prisma generate` first — a schema change requires a rebuild, not just a restart.
- The Prisma client is generated into `src/generated/prisma/` (gitignored). Import models, enums and the `Prisma` namespace from `@/generated/prisma/client`, never from `@prisma/client`; take the client instance from `@/lib/prisma`.
- Connection URLs are not in the schema: the CLI reads `DIRECT_URL` in `prisma.config.ts`, the app reads `DATABASE_URL` (pooler) in `src/lib/prisma.ts`, which also sets pool size, TLS and timeouts.
- The database role `postgres` must keep `extra_float_digits = 3`. The `pg` driver reads results as text, and with Supabase's default (0) every Float arrives rounded to 15 digits — enough to push `Math.ceil` quantities up by one. The pooler ignores startup parameters, so the setting lives on the role (see `src/lib/prisma.ts`).
- Replenishment decisions (min/max in `stock-levels.ts`, candidates, suggested qty and urgency in `replenishment.ts`) use `avgDailySales30d`. A backtest on 150 days of POS sales showed the 7-day window erring 69% vs 55% for 30 days and dropping products that sell monthly but not that week. Descriptive screens (ABC, OTB, categories, AI alerts) still use `avgDailySales7d`; don't switch them without measuring.
- The seasonal factor (`seasonalFactorFor` in `seasonality.ts`) is shrunk toward 1 with weight `years / (years + 1)`: with one year of history the raw ratio predicted worse than no adjustment. Keep the shrinkage until there is enough history to re-measure.
- Replenishment counts (dashboard card, plan totals) only include A/B lines, the ones preselected; C lines are listed with qty 0.
- Raw SQL: pass dates as ISO strings with an explicit cast (`${d.toISOString()}::timestamptz`, `${key}::date`), not as `Date` objects. The adapter sends a `Date` without a time zone, and Postgres then casts it to the column's type — against a `date` column that shifts the day.

<!-- agent-kit:start -->
## Seguridad
- Nunca leer, imprimir ni pegar `.env*`, llaves, tokens, dumps de BD ni datos reales de clientes. Usa `.env.example` como referencia de variables.
- Comandos destructivos (`rm -rf`, `git push --force`, migraciones, SQL en producción, deploys a prod) requieren confirmación explícita de Henry.
- Supabase/Vercel: solo branches y previews desde el agente. Producción la ejecuta Henry.

## Git
- Sin atribución de IA en commits, PRs ni issues (nada de `Co-Authored-By` ni "Generated with").
- Commits en el idioma del historial del repo. Staging por rutas explícitas; nunca `git add -A`.
- Una sesión = una tarea = una rama/PR. `/clear` entre tareas.

## Documentación
- `CONTEXT.md`: glosario del dominio. Usa esos términos en código, commits y respuestas. Si aparece un término nuevo, agrégalo.
- `ESTADO.md`: estado de la tarea actual. **Al terminar cada sesión (o con `/handoff`), actualiza Hecho / Pendiente / Bloqueado / Siguiente paso.**
- `docs/adr/`: una ADR por decisión de arquitectura o producto que costó tomar. Plantilla en `docs/adr/0000-plantilla.md`.
- `CHANGELOG.md`: una línea por cambio entregado, bajo "Sin publicar".

## Cómo trabajar
- Lee `ESTADO.md` y `CONTEXT.md` antes de empezar.
- Cambios no triviales: alinear primero (`/grill-with-docs` o preguntas), luego spec, luego implementar con tests.
- Antes de proponer una librería nueva, revisa si ya hay algo equivalente en el repo.
<!-- agent-kit:end -->

## Agent skills

### Issue tracker

Issues live in GitHub Issues (hdgarzon/utilia) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- skills-flow:start -->
## Flujo de skills

Propón la skill en el momento indicado; no esperes a que Henry la recuerde. Si él dice que no, sigue sin ella.

| Fase | Skill | Cuándo proponerla |
|---|---|---|
| Idea / decisión | `/abogado-del-diablo` | Decisión cara o difícil de revertir: infraestructura, cliente, dinero, seguridad |
| Idea / decisión | `/grill-me` | Decisiones que no son de código |
| Diseño | `/grill-with-docs` | Cambio no trivial sin spec. Antes de escribir código |
| Plan | `/to-spec` → `/to-tickets` | Al terminar un grill, o cuando el trabajo no cabe en una sesión |
| Construcción | `/implement` (con `/tdd`) | Hay spec o tickets listos |
| Construcción | `/caveman` | Sesiones largas de código. Apagar (`/caveman off`) para grills, reviews y textos para clientes |
| Bugs | `/diagnosing-bugs` | Tras dos intentos fallidos con un bug. Detente y cámbiate a esta skill |
| Revisión | `/code-review` | Antes de abrir o fusionar un PR |
| Cierre | `/handoff` | Antes de terminar la sesión: deja `ESTADO.md` al día |
| Cualquiera | `/wait-what` | Si Henry dice que no entendió una respuesta |

Reglas:
- Una sesión = una fase. Si el trabajo salta de fase (por ejemplo, de diseño a construcción), sugiere `/handoff` y una sesión nueva.
- No uses skills de otros plugins (10x-Team, etc.) para estas fases si existe una de esta tabla.
<!-- skills-flow:end -->
