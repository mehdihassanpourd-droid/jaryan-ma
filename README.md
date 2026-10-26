# جریان ما (Jaryan Ma)

> اینجا هنر در جریان است

Online store and gallery for Iranian handmade art. Persian (RTL), Toman currency, single-vendor today and structured for a future multi-vendor marketplace. Instagram: [@jaryan.ma](https://instagram.com/jaryan.ma)

**Status:** foundation phase. The homepage is built; all products, categories and images are **demo content**. Payments are not implemented.

Docs: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [CLAUDE.md](CLAUDE.md)

## Requirements
- Node.js ≥ 20.9 (developed on 22)
- npm
- PostgreSQL 14+ (only needed once you work on database-backed features)

## Getting started
```bash
npm install
cp .env.example .env      # then edit DATABASE_URL (never commit .env)
npm run db:generate       # generate the Prisma client
npm run dev               # http://localhost:3000
```
The homepage currently renders from `src/data/demo-catalog.ts` and does not need a database.

### Database (optional for now)
```bash
createdb jaryan_ma
npm run db:migrate        # creates and applies the first migration
npm run db:studio
```

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest |
| `npm run db:validate` | Validate Prisma schema |
| `npm run check` | lint + typecheck + test + schema validation |

## Project structure
See [ARCHITECTURE.md](ARCHITECTURE.md#2-layout).

## Contributing
Branch from the default branch, run `npm run check && npm run build`, open a PR. Follow the rules in [CLAUDE.md](CLAUDE.md).
