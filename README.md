# 🏪 NexusPOS

> Modern web-based Point of Sale system for small and medium businesses.

[![CI](https://github.com/your-org/nexuspos/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nexuspos/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Nginx (port 80)                      │
│                     Static files + Reverse proxy            │
├────────────────────────────┬────────────────────────────────┤
│                            │                                │
│   ┌────────────────────┐   │   ┌────────────────────────┐   │
│   │     Frontend       │   │   │      Backend           │   │
│   │  React 19 + Vite   │◄──┼──►│  NestJS + Prisma       │   │
│   │  Tailwind + shadcn │   │   │  REST API (/api/v1)    │   │
│   │  port 5173 (dev)   │   │   │  port 3000             │   │
│   └────────────────────┘   │   └───────────┬────────────┘   │
│                            │               │                │
│   ┌────────────────────┐   │   ┌───────────▼────────────┐   │
│   │  Shared Package    │   │   │     PostgreSQL 16      │   │
│   │  @nexuspos/shared  │   │   │     port 5432          │   │
│   │  Types + Constants │   │   └────────────────────────┘   │
│   └────────────────────┘   │                                │
└────────────────────────────┴────────────────────────────────┘
```

## Tech Stack

| Layer    | Technology                                      |
| -------- | ----------------------------------------------- |
| Frontend | React 19, Vite 6, Tailwind CSS v4, shadcn/ui    |
| State    | TanStack Query v5 (server), Zustand v5 (client) |
| Backend  | NestJS v11, Prisma v6, class-validator          |
| Database | PostgreSQL 16                                   |
| Monorepo | pnpm workspaces                                 |
| Tooling  | ESLint v9, Prettier, Husky, lint-staged         |
| DevOps   | Docker, Docker Compose, GitHub Actions          |
| Language | TypeScript 5.8 (strict mode)                    |

## Prerequisites

- **Node.js** ≥ 22.0.0
- **pnpm** ≥ 11.0.0
- **Docker** & **Docker Compose** (for database)
- **Git**

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/nexuspos.git
cd nexuspos

# 2. Install dependencies
pnpm install

# 3. Start PostgreSQL (via Docker)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 4. Setup the database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Start development servers
pnpm dev
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000/api/v1
- **Health Check**: http://localhost:3000/api/v1/health
- **pgAdmin**: http://localhost:5050 (admin@nexuspos.dev / admin)

## Project Structure

```
nexuspos/
├── apps/
│   ├── backend/                  # NestJS REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # Database schema
│   │   │   └── seed.ts          # Seed script
│   │   └── src/
│   │       ├── common/          # Shared utilities (Prisma, guards, filters)
│   │       ├── modules/         # Feature modules (health, auth, products...)
│   │       ├── app.module.ts    # Root module
│   │       └── main.ts          # Bootstrap
│   │
│   └── frontend/                 # React SPA
│       └── src/
│           ├── components/ui/   # shadcn/ui components
│           ├── features/        # Feature modules
│           ├── hooks/           # Custom React hooks
│           ├── lib/             # Utilities (api-client, query-client)
│           ├── providers/       # React context providers
│           ├── stores/          # Zustand stores
│           └── App.tsx          # Root component
│
├── packages/
│   └── shared/                   # @nexuspos/shared
│       └── src/
│           ├── types/           # ApiResponse, PaginatedResponse, etc.
│           └── constants/       # APP, PAGINATION, Status enum
│
├── .github/workflows/ci.yml     # CI pipeline
├── docker-compose.yml            # Production compose
├── docker-compose.dev.yml        # Dev override (DB + pgAdmin only)
├── eslint.config.mjs             # ESLint flat config
├── pnpm-workspace.yaml           # Workspace definition
└── package.json                  # Root scripts & dev dependencies
```

## Available Scripts

### Root (monorepo)

| Command             | Description                                 |
| ------------------- | ------------------------------------------- |
| `pnpm dev`          | Start all apps in development mode          |
| `pnpm dev:backend`  | Start only the backend                      |
| `pnpm dev:frontend` | Start only the frontend                     |
| `pnpm build`        | Build all packages                          |
| `pnpm lint`         | Lint entire workspace                       |
| `pnpm lint:fix`     | Lint and auto-fix                           |
| `pnpm format`       | Format all files with Prettier              |
| `pnpm format:check` | Check formatting without writing            |
| `pnpm typecheck`    | Typecheck all packages                      |
| `pnpm clean`        | Remove all build artifacts and node_modules |

### Database

| Command            | Description                           |
| ------------------ | ------------------------------------- |
| `pnpm db:generate` | Generate Prisma client                |
| `pnpm db:migrate`  | Run database migrations (dev)         |
| `pnpm db:seed`     | Seed the database                     |
| `pnpm db:studio`   | Open Prisma Studio (visual DB editor) |

## Environment Variables

### Backend (`apps/backend/.env`)

| Variable         | Description                  | Default                 |
| ---------------- | ---------------------------- | ----------------------- |
| `NODE_ENV`       | Environment mode             | `development`           |
| `PORT`           | API server port              | `3000`                  |
| `DATABASE_URL`   | PostgreSQL connection string | See `.env.example`      |
| `CORS_ORIGIN`    | Allowed CORS origin          | `http://localhost:5173` |
| `JWT_SECRET`     | JWT signing secret           | —                       |
| `JWT_EXPIRATION` | JWT token lifetime           | `7d`                    |

### Frontend (`apps/frontend/.env`)

| Variable       | Description     | Default                        |
| -------------- | --------------- | ------------------------------ |
| `VITE_API_URL` | Backend API URL | `http://localhost:3000/api/v1` |

## Docker Usage

### Development (database only)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Production (full stack)

```bash
docker compose up -d
```

### Useful commands

```bash
docker compose logs -f backend    # Tail backend logs
docker compose down               # Stop all services
docker compose down -v            # Stop and remove volumes
```

## Adding shadcn/ui Components

```bash
cd apps/frontend
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add input
```

## Contributing

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Ensure checks pass: `pnpm lint && pnpm build`
4. Commit (Husky will run lint-staged automatically)
5. Push and create a Pull Request

## License

[MIT](./LICENSE)
