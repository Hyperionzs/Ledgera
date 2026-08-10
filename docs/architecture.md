# Architecture

Ledgera is a monorepo POS system built with pnpm workspaces.

## Layout

```
apps/
  backend/    NestJS 11 REST API (CommonJS, webpack bundle → dist/main.js)
  frontend/   React 19 + Vite 6 SPA (ESM)
packages/
  shared/     @ledgera/shared — shared types + constants (consumed as built dist)
```

## Backend

- **NestJS 11 + Prisma 6** (PostgreSQL).
- Global prefix `api/v1`.
- Global `ValidationPipe` (`whitelist`, `transform`, `forbidNonWhitelisted`).
- Global guards: `JwtAuthGuard` (default ON, `@Public()` opts out) + `RolesGuard`.
- Envelope: `TransformInterceptor` → `ApiResponse<T>`, `HttpExceptionFilter` → `ApiError`.
- Feature modules (one folder each): health, auth, users, products, categories.
  Every module follows the same shape: `*.module.ts`, `*.controller.ts`,
  `*.service.ts`, `dto/`, `*.spec.ts` (e2e).

## Design principles

- **Soft delete everywhere** — master data rows are never physically removed;
  `deletedAt` is stamped and all queries filter `deletedAt: null`.
- **Money is `Decimal`** (`@db.Decimal(12, 2)`) — never float.
- **RBAC** — `Role.OWNER` / `Role.ADMIN` manage; `Role.CASHIER` read-only.

## Critical constraint: `@ledgera/shared`

The shared package is consumed as **build output** (`dist/`, CJS), not source.
Rebuild after changing it:

```bash
pnpm --filter @ledgera/shared exec tsc -p tsconfig.json
```

Do not add a TS `paths` alias mapping it to source — this breaks the webpack
backend bundle (TS6059). See [CLAUDE.md](../CLAUDE.md).
