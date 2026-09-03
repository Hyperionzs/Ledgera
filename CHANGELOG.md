# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

- Dashboard & Analytics
- Frontend Integration
- Deployment + CI/CD

---

## [v0.9.0] - 2026-09-02

### Added

- Customer Management module: `Customer` model (name required, email/phone/address/city/notes optional) + 5 REST endpoint (`POST/GET/GET:id/PATCH/DELETE`) dengan RBAC (ADMIN/OWNER tulis, all authenticated baca).
- Soft delete customer: `isActive` + `deletedAt` field, baris tetap tersimpan untuk sejarah.
- Walk-in sentinel customer: UUID tetap `00000000-0000-0000-0000-000000000000`, protected dari deletion, digunakan untuk anonymous sales.
- Customer snapshot pattern: `customerName` dicapture saat sale creation untuk immutable history, customer bisa dihapus tanpa merusak historical sales.
- Sales integration: `Sale.customerId` kini required (always link ke Customer, walk-in untuk anonymous).
- Pagination & search customer: limit/page/search case-insensitive pada name/email/phone.
- Customer history API: GET `/customers/:id` includes sale history + purchase stats.
- Email uniqueness via partial unique index: email unik hanya untuk active customer (`isActive=true AND deletedAt=null`), memungkinkan email reuse setelah soft delete.
- 50 end-to-end test customer.

### Changed

- `Sale` model: `customerId` kini required (bukan nullable), FK relation ke `Customer` dengan `onDelete: SetNull`.
- Skema menambah `Customer` model dengan soft-delete pattern dan indexes.

### Fixed

- Global email `@unique` constraint tadinya blocking soft-delete customer — diganti partial unique index di PostgreSQL.
- Double-wrapped API response di controller — controller return langsung (interceptor handle wrapping).
- Test data isolation: email/SKU generator lacked monotonic counter, diganti atomic counter per test.

### Database

- New model: `Customer` dengan soft-delete pattern.
- New migration: Partial unique index on email (active customers only).
- New seed: Walk-in sentinel customer initialization.

---

## [v0.8.0] - 2026-09-01

### Added

- Sales Management module: `Sale` & `SaleItem` model + 4 REST endpoint (`POST/GET/GET:id/DELETE`) dengan RBAC (ADMIN/OWNER tulis, all authenticated baca).
- Atomic sale creation: semua operasi (validate items, fetch product, calculate total, create sale+items, stock-out) di dalam `prisma.$transaction` — all-or-nothing.
- Server-side price calculation: `sellingPrice` diambil dari DB (bukan trust client), `totalAmount` computed menggunakan `Prisma.Decimal` untuk akurasi.
- Product snapshot pattern: `productName` dicapture saat sale creation untuk immutable history.
- Inactive/soft-deleted product blocking: cegah sale produk yg tidak aktif atau soft-deleted.
- Stock-out atomik via InventoryService transaction: setiap sale item trigger `stockOutTx()` → decrement `Product.stock` + create `StockMovement` (SALE_OUT type).
- `INSUFFICIENT_STOCK` error (400) jika stok tidak cukup; entire sale rolls back.
- Referensi inventory movement: `StockMovement.referenceType='SALE'` + `referenceId` link ke sale.
- 27 end-to-end test sales.

### Changed

- `Sale` model kini include `customer` relation (prepared untuk Customer module Sprint 9).
- Skema menambah `Sale` & `SaleItem` model, enum `SaleStatus`.

### Fixed

### Database

- New models: `Sale`, `SaleItem`.
- New enum: `SaleStatus`.

---

## [v0.7.0] - 2026-08-31

### Added

- Purchase Management module: `Purchase` & `PurchaseItem` model + 4 REST endpoint (`POST/GET/GET:id/DELETE`) dengan RBAC (ADMIN/OWNER tulis, all authenticated baca).
- Atomic purchase creation: supplier resolution, product validation, item snapshot, total calculation, purchase+items creation, stock-in — semua di `prisma.$transaction`.
- Supplier integration: `Purchase.supplierId` (nullable) + supplier name snapshot (`supplierName`).
- Product snapshot pattern: `productName` dicapture saat purchase creation untuk immutable history.
- Atomic stock-in via InventoryService transaction: setiap purchase item trigger `stockInTx()` → increment `Product.stock` + create `StockMovement` (STOCK_IN type).
- Referensi inventory movement: `StockMovement.referenceType='PURCHASE'` + `referenceId` link ke purchase.
- Pagination & list purchase dengan supplier/date filtering.
- 17 end-to-end test purchases.

### Changed

- `Purchase` model kini include `supplier` relation (nullable).
- Skema menambah `Purchase` & `PurchaseItem` model, enum `PurchaseStatus`.
- `StockMovement` menambah `referenceType`/`referenceId` untuk link ke transaksi asal.

### Fixed

### Database

- New models: `Purchase`, `PurchaseItem`.
- New enum: `PurchaseStatus`.
- Schema update: `StockMovement.referenceType` & `referenceId`.

---

## [v0.6.0] - 2026-08-10

### Added

- Inventory Management module: hybrid model `Product.stock` (current) + `StockMovement` (audit trail lengkap) + enum `MovementType`, 3 endpoint tulis (`POST stock-in`, `stock-out`, `adjust`) + 2 baca (`GET /inventory`, `GET /inventory/:productId`).
- Mutasi stok atomik: semua operasi di dalam `prisma.$transaction` — insert movement + update `Product.stock` all-or-nothing; `increment`/`decrement` atomic (kebal lost update).
- `beforeStock`/`afterStock` snapshot di tiap movement — riwayat terbaca tanpa menghitung ulang; `quantity` selalu positif (ADJUSTMENT menyimpan `|delta|`).
- Cegah stok negatif via `INSUFFICIENT_STOCK` (400); ADJUSTMENT wajib `reason`; ADJUSTMENT diset ke nilai absolut target.
- `referenceType`/`referenceId` nullable pada movement — siap diisi Purchase (`PURCHASE`) / Sales (`SALE`) tanpa perubahan skema.
- Relasi `Product.supplierId` (nullable) + daftar inventory menampilkan kategori & supplier — dashboard tanpa join tambahan.
- 22 end-to-end test inventory; total 125 test backend pass.

### Changed

- `Product` menambah kolom `stock` (default 0) dan relasi `supplierId`.
- Skema menambah enum `MovementType`, model `StockMovement`, index `[productId]` dan `[createdAt]`.

### Fixed

### Notes

- Tech debt terdokumentasi: race window pada mutasi stok bersamaan (Prisma belum punya `SELECT ... FOR UPDATE` native) — MVP andalkan transaction + atomic update; production pertimbangkan pessimistic/optimistic locking + retry.

---

## [v0.5.0] - 2026-08-10

### Added

- Supplier Management module: `Supplier` model + 6 endpoint REST (`POST/GET/GET:id/PATCH/PATCH:id/status/DELETE`) dengan RBAC (ADMIN/OWNER tulis, CASHIER baca).
- Normalisasi data bebas teks: trim + collapse spasi pada `name`/`contactName`/`phone`/`address`; `email` disimpan lowercase.
- Uniqueness di service (bukan constraint DB): `name` unik antar supplier aktif (case-/whitespace-insensitive), `email` unik bila diisi; keduanya boleh dipakai ulang setelah soft delete.
- Filter `isActive` pada list endpoint + search `name`/`contactName`.
- 32 end-to-end test supplier; total 103 test backend pass.

### Changed

- `docs/` diperbarui (api + database) mencakup modul supplier.

### Fixed

- Query boolean `isActive=false` tadinya salah parse (class-transformer `Boolean('false')` → `true`); kini transform custom menangani `'true'/'false'/'1'/'0'`.
- Nama kosong setelah normalisasi (`'   '`) tadinya 500; kini ditolak `SUPPLIER_NAME_REQUIRED` (400).

---

## [v0.4.0] - 2026-08-10

### Added

- Category Management module: `Category` model (nama unik per-parent, hierarki parent/child via self-relation).
- 6 endpoint REST kategori (`POST/GET/GET:id/PATCH/PATCH:id/status/DELETE`) dengan RBAC (ADMIN/OWNER tulis, CASHIER baca).
- Soft delete hierarkis: hapus kategori = cascade ke semua turunannya; diblokir jika masih dipakai produk (`CATEGORY_IN_USE`).
- Validasi parent: parent harus ada & aktif, tidak boleh jadi keturunannya sendiri (cycle guard), pindah ke root via `parentId: null`.
- Dokumentasi awal: `docs/` (architecture, database, api, branching, deployment).

### Changed

- Relasi `Product.categoryId` kini FK ke `Category` (sebelumnya nullable tanpa relasi).
- Skema menambah `@@index([categoryId])` pada Product.

### Fixed

- Test fixture email pada kategori dipaksa lowercase — login memakai `email.toLowerCase()` dan Postgres case-sensitive.

---

## [v0.3.0] - 2026-08-10

### Added

- Product Management module: `Product` model (sku unik, barcode opsional unik, harga beli/jual, stok minimum, status aktif, soft delete) + 6 endpoint REST (`POST/GET/GET:id/PATCH/PATCH:id/status/DELETE`).
- Validasi bisnis produk: SKU & barcode wajib unik (`409`), harga jual tidak boleh di bawah harga beli (`400`), nama wajib diisi.
- Soft delete produk — baris tetap tersimpan untuk sejarah, otomatis tidak terlihat di semua query.
- RBAC produk: `OWNER`/`ADMIN` bisa CRUD, `CASHIER` hanya baca.
- Pencarian produk (nama/SKU, case-insensitive) + pagination konsisten dengan modul user.
- 20 end-to-end test produk; total 38 test backend pass. Test suite kini `--runInBand` agar dua suite e2e yang berbagi satu test DB tidak saling tabrakan.

### Changed

- `PATCH /products/:id` memvalidasi harga terhadap nilai tersimpan — mengubah hanya satu sisi harga tetap dicek.
- Skrip `test` backend menambah `--runInBand --testTimeout=30000` (stabilitas suite paralel + Windows lambat).

### Fixed

- Bug validasi harga pada update: dulu hanya dicek bila `purchasePrice` dan `sellingPrice` dikirim sekaligus; sekarang selalu dicek terhadap state gabungan.

---

## [v0.2.0] - 2026-08-09

### Added

- User Management module: CRUD user, profil sendiri, ubah role/status dengan proteksi last-OWNER dan self-protection.
- RBAC lengkap (`OWNER`, `ADMIN`, `CASHIER`) dengan guard global.
- Manajemen session & refresh token rotation (JWT 15 menit + refresh 7 hari).

### Changed

### Fixed

- Collision placeholder `token_hash` pada refresh token rotation diganti `randomUUID()`.

---

## [v0.1.0] - 2026-08-08

### Added

- Foundation monorepo: pnpm workspaces, NestJS backend, React + Vite frontend, paket `@ledgera/shared`.
- Autentikasi JWT (access + refresh rotation), RBAC, rate limiting, envelope respons `ApiResponse`/`ApiError`.
- Rename project NexusPOS → Ledgera.

### Changed

### Fixed
