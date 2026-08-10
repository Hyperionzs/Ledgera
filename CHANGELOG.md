# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

- Supplier Management
- Inventory Transaction (stock adjustment, stock movement)
- Purchase Module
- Sales Module
- Dashboard & Analytics
- Frontend Integration
- Deployment + CI/CD

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
