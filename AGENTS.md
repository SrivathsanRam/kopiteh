# AGENTS.md

## Architecture

- **Monorepo with 3 packages:** `backend/` (Express API), `frontend/` (Next.js 15 app), `types/` (shared TypeScript types).
- **Shared types:** `types/` is the source of truth for DTOs. Frontend imports them via `@types/*` path alias (`tsconfig.json` paths). Backend defines its own payload/response types under `backend/src/types/`.
- **Backend is Dockerized** (PostgreSQL 17 + Express). Frontend runs locally with Turbopack.

## Commands

### Backend (run inside `backend/`)
```bash
# Start (Docker required)
docker compose up --build

# DB reset + seed (run inside the container, in order)
docker compose exec backend npm run rollback
docker compose exec backend npm run migrate
docker compose exec backend npm run seed

# TypeScript check (no emit)
npm run typecheck
```

### Frontend (run inside `frontend/`)
```bash
npm run dev          # next dev --turbopack
npm run lint         # eslint (next/core-web-vitals)
```

- Root `package.json` has a placeholder `test` script — no tests exist yet.
- Backend `npm run dev` runs `ts-node src/index.ts` (for non-Docker local dev).

## Backend conventions

### Layered pattern for adding a new resource
1. Define payload in `backend/src/types/payloads.ts`
2. Add validation middleware in `backend/src/middleware/<name>.validation.ts`
3. Add service in `backend/src/services/<name>.service.ts` — use `SuccessCodes`/`ErrorCodes`
4. Add controller in `backend/src/controllers/<name>.controller.ts` — call validation helpers, pass to service
5. Add routes in `backend/src/routes/<name>.routes.ts` — import controller + middleware
6. Mount the router in `backend/src/routes/index.ts`

### API response shape
All responses follow: `{ success: boolean, payload: { message: string, data: T } }`.
Frontend's `fetchClient<T>()` in `frontend/lib/api.ts` unwraps this automatically — throw on `success: false`, return `payload.data`.

### Database
- No ORM — raw SQL via `pg` Pool (`backend/src/config/database.ts`).
- Migrations are `.sql` files in `backend/migrations/`, run sequentially and tracked in `_migrations` table.
- Production uses `DATABASE_URL` / `SUPABASE_URL` with SSL; dev uses individual env vars (`POSTGRES_USER`, etc.).

### Auth
- JWT-based (access + refresh tokens). Admin signup requires `ADMIN_SIGNUP_CODE`.
- `authenticateToken` middleware guards write routes.

### WebSocket
- Socket.io server in `backend/src/services/websocket.service.ts` for real-time order updates.
- Runners join stall rooms, customers join user rooms.

### Tsconfig
- `target: ES2020`, `module: commonjs`, `strict: true`, `rootDir: ./src`, `outDir: ./dist`.

## Frontend conventions

- **App Router** (`app/`). Three modules: `/admin`, `/runner`, `/ordering`.
- **State:** Zustand with `persist` middleware (`frontend/stores/`). Auth tokens stored in localStorage.
- **Styling:** Tailwind CSS v4 + shadcn/ui components (`components/ui/`).
- **API client:** `frontend/lib/api.ts` — all API calls go through `fetchClient<T>()` which handles CORS, error unwrapping, and JSON parsing.
- **Environment:** `.env` defines `NEXT_PUBLIC_API_URL` (backend URL) and `NEXT_PUBLIC_RUNNER_CODE`.
- **Tsconfig:** `strict: false`, `moduleResolution: Bundler`, `@/*` → `./*`, `@types/*` → `../types/*`.
- **Lint:** `next/core-web-vitals` via flat ESLint config.

## Gotchas

- `.env` files contain secrets and are gitignored but **do exist in both `backend/` and `frontend/`** — do not delete them.
- Frontend imports types from `../../types` (relative) in some files despite the `@types/*` alias; both patterns work.
- Backend `npm run install` must run inside Docker first, or run `npm install` locally in `backend/` for type checking.
- The root `node_modules/` is mostly unused — each sub-package has its own `package.json` and `node_modules/`.
- No CI/CD, no lint-staged, no pre-commit hooks.
- `frontend/components.json` is the shadcn/ui config file — do not delete it.
