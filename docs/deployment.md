# Deployment

Local development only at this stage. Production deployment/CI is a later
sprint (`docs/` will be extended then).

## Requirements

- Node 22+, pnpm 9+, PostgreSQL (dev via docker-compose).

## Run locally

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # postgres
pnpm db:generate
pnpm db:push                                            # sync schema (no migrations yet)
pnpm db:seed
pnpm dev                                                # backend watch + frontend vite
```

Backend → `http://localhost:3000/api/v1`, frontend → Vite default port.

## Quality gates (run all before commit)

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm --filter @ledgera/backend test    # needs DATABASE_URL → ledgera_test
```

## Environment

- Backend reads `.env` (`DATABASE_URL`, JWT secrets, ports).
- Frontend reads `VITE_API_URL` (default `http://localhost:3000/api/v1`).
- `.env.example` documents the shape; `.env` is git-ignored.

## Notes / known debt

- Schema is synced with `db push`, not migration files yet.
- Dev + test databases are separate (`nexuspos_dev`, `ledgera_test`).
- CI (`.github/workflows/ci.yml`) runs lint/format/typecheck/build — test job
  to be added in a future sprint.
