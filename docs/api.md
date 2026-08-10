# API

Base URL: `http://localhost:3000/api/v1`

All endpoints require `Authorization: Bearer <accessToken>` unless marked
`@Public()` (auth routes).

## Response envelope

Success:

```json
{ "success": true, "data": { ... }, "timestamp": "..." }
```

Error:

```json
{ "success": false, "error": { "code": "...", "message": "..." }, "timestamp": "..." }
```

## Roles

| Role    | Scope                                       |
| ------- | ------------------------------------------- |
| OWNER   | full CRUD everywhere, user management       |
| ADMIN   | same as OWNER except user role/status rules |
| CASHIER | read-only on master data                    |

## Endpoints

### Auth (`@Public`)

- `POST /auth/register`
- `POST /auth/login` → `{ accessToken, refreshToken }`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `PATCH /auth/change-password`

### Users (OWNER/ADMIN)

- `GET /users` · `GET /users/:id`
- `PATCH /users/:id` (profile only)
- `PATCH /users/:id/status` · `PATCH /users/:id/role`
- `DELETE /users/:id`

### Products (write: ADMIN/OWNER, read: any)

- `POST /products`
- `GET /products?page=1&limit=20&search=`
- `GET /products/:id`
- `PATCH /products/:id`
- `PATCH /products/:id/status` `{ isActive: boolean }`
- `DELETE /products/:id` (soft)

### Categories (write: ADMIN/OWNER, read: any)

- `POST /categories`
- `GET /categories?search=` (returns tree)
- `GET /categories/:id` (returns parent, children, counts)
- `PATCH /categories/:id`
- `PATCH /categories/:id/status` `{ isActive: boolean }`
- `DELETE /categories/:id` (soft; cascade to children)

### Suppliers (write: ADMIN/OWNER, read: any)

- `POST /suppliers`
- `GET /suppliers?page=1&limit=20&search=&isActive=` (name + contactName search, status filter)
- `GET /suppliers/:id`
- `PATCH /suppliers/:id`
- `PATCH /suppliers/:id/status` `{ isActive: boolean }`
- `DELETE /suppliers/:id` (soft)

## Common error codes

| Code                               | Meaning                                |
| ---------------------------------- | -------------------------------------- |
| `UNAUTHORIZED`                     | bad/missing token, invalid credentials |
| `INVALID_CREDENTIALS`              | wrong email/password                   |
| `FORBIDDEN`                        | role insufficient                      |
| `NOT_FOUND` / `CATEGORY_NOT_FOUND` | resource missing or soft-deleted       |
| `SKU_TAKEN` / `BARCODE_TAKEN`      | unique constraint hit                  |
| `PRICE_INVALID`                    | selling price below purchase price     |
| `CATEGORY_NAME_TAKEN`              | duplicate sibling name                 |
| `CATEGORY_IN_USE`                  | delete blocked by product reference    |
| `INVALID_PARENT`                   | parent missing/deleted/cycle           |
| `SUPPLIER_NAME_TAKEN`              | duplicate active supplier name         |
| `SUPPLIER_EMAIL_TAKEN`             | duplicate active supplier email        |
| `SUPPLIER_NAME_REQUIRED`           | name blank after normalization         |
