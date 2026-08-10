# Database

PostgreSQL (local dev via docker-compose). Single source of truth:
`apps/backend/prisma/schema.prisma`.

## Models

| Model          | Purpose                         | Notable constraints                                                                     |
| -------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `User`         | Auth + profile                  | `email @unique`, `role` enum                                                            |
| `RefreshToken` | Active session + token rotation | `tokenHash @unique` (sha256 of raw token)                                               |
| `Product`      | Catalog item                    | `sku @unique`, `barcode @unique?`, prices `Decimal(12,2)`, `categoryId` FK → `Category` |
| `Category`     | Hierarchical grouping           | `@@unique([name, parentId])`, self-relation tree                                        |
| `Supplier`     | Vendor                          | no unique constraint on name/email (enforced in service among active rows)              |

## Conventions

- snake_case columns via `@map`.
- `created_at` / `updated_at` on every table.
- `deleted_at` nullable = soft delete.

## Case-sensitivity warning

Postgres string comparison is case-sensitive. The auth login lowercases the
email before lookup, so **fixtures/emails must be stored lowercase**. Supplier
emails are normalized (trim + lowercase) at the service layer before storage.

## Normalization

Free-text fields (`name`, `contactName`, `phone`, `address`) are trimmed and
inner whitespace is collapsed to a single space. Name uniqueness compares the
normalized form case-insensitively.

## Unique + soft delete nuance

`@@unique([name, parentId])` does **not** enforce root-level uniqueness: in
Postgres `NULL != NULL`, so two root categories (`parentId = NULL`) with the
same name still pass the composite index. Root uniqueness is enforced in the
service layer (`CATEGORY_NAME_TAKEN`).

## Working with schema

```bash
pnpm db:generate                 # regenerate Prisma client
pnpm db:migrate                  # dev migration
pnpm db:push                     # sync schema to DB (no migration history)
```

Test suite targets a dedicated DB (`ledgera_test`); set
`DATABASE_URL=...ledgera_test...` when running `pnpm --filter @ledgera/backend test`.
