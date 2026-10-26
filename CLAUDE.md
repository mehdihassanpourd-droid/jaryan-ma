# CLAUDE.md — development rules for جریان ما

Read `PRD.md` and `ARCHITECTURE.md` first.

## Commands
- `npm run dev` — dev server · `npm run build` — production build
- `npm run check` — lint + typecheck + tests + `prisma validate` (run before every commit)
- `npm run db:generate` — regenerate Prisma client after schema edits

## Hard rules
1. **No secrets in git.** Never commit `.env*` (except `.env.example` with placeholders), keys, tokens, or DB URLs with real credentials.
2. **No payment processing** until explicitly scheduled (PRD Phase 3).
3. **No invented business facts:** no real prices, artist names/bios, testimonials or statistics. Unknown prices are `null`.
4. **Demo content is labelled.** Sample data lives only in `src/data/` with `isDemo: true` and a visible "نمونه" badge. Remove the banner/badges only when real data replaces it.
5. **Keep multi-vendor readiness:** new product/order code must carry `vendorId`; don't hard-code a single seller.
6. Work on feature branches; open PRs; never push to the default branch directly.

## Code conventions
- TypeScript strict; no `any`; prefer Server Components, add `"use client"` only for interactivity.
- Components: one per file, PascalCase, named exports, props typed inline or via `interface`. Generic primitives in `components/ui`, domain parts in `components/<domain>`.
- Components never import Prisma; go through `src/server/*` repositories (once present).
- Money: integer Toman, format with `formatToman`/`formatNumber`.
- Add or update a Vitest test for any non-trivial logic in `src/lib` or `src/server`.

## UI / RTL / Persian
- Pages are `lang="fa" dir="rtl"`. Use logical utilities (`ms-/me-/ps-/pe-/start-/end-/text-start`), never `left/right/ml/mr` for layout direction.
- Wrap LTR strings (handles, URLs, SKUs) with `dir="ltr"`.
- Colours only from theme tokens (`ivory`, `sand`, `bark`, `olive`); don't hard-code hex in components (the SVG placeholder palette is the one exception).
- Mobile-first: write base styles for phones, then `sm:`/`md:`/`lg:`.
- Accessibility: semantic landmarks, alt text in Persian, visible focus, respect reduced motion, ≥ AA contrast.
- Persian copy: natural, concise; use ZWNJ (‌) correctly (e.g. «می‌شود»).

## Definition of done
`npm run check` and `npm run build` pass; UI checked at ~390px and ~1280px; docs updated if behaviour or architecture changed.
