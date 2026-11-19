# AGENTS.md

## Architecture

- **Monorepo with 3 packages:** `backend/` (Express API), `frontend/` (Next.js 16 app), `types/` (shared TypeScript types).
- **Shared types:** `types/` is the source of truth for DTOs. Frontend imports them via `@types/*` path alias (`tsconfig.json` paths). Backend defines its own payload/response types under `backend/src/types/`.
- **Backend is Dockerized** (Express + Firebase Admin SDK). Production runs on
  Cloud Run and uses Cloud Firestore and Cloud Storage. Frontend runs locally
  with Turbopack and deploys through Firebase App Hosting.

## Commands

### Backend (run inside `backend/`)
```bash
# TypeScript check (no emit)
npm run typecheck

# Production build
npm run build

# Local container (Firebase emulators must be running from the repo root)
docker compose up --build
```

### Frontend (run inside `frontend/`)
```bash
npm run dev          # next dev --turbopack
npm run lint         # eslint (next/core-web-vitals)
```

- Root `package.json` has a placeholder `test` script — no tests exist yet.
- Backend `npm run dev` runs `ts-node src/index.ts` and can use the Firebase
  emulators configured in `backend/.env`.

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

### Data and storage
- Cloud Firestore is accessed only by the backend through the Firebase Admin
  SDK. Helpers and collection names live in
  `backend/src/services/firestore.service.ts`.
- Production credentials come from the Cloud Run service account through
  Application Default Credentials. Local development uses Firebase emulators.
- Images are written to the `public/` prefix in Firebase Cloud Storage.

### Auth
- Firebase Authentication supplies administrator ID tokens. Admin signup still
  requires `ADMIN_SIGNUP_CODE`, and the backend adds the `admin` custom claim.
- `authenticateToken` verifies Firebase ID tokens and guards administrator
  routes. Customer orders remain anonymous. Runner access keeps its existing
  client-side runner-code flow.

### WebSocket
- Socket.io server in `backend/src/services/websocket.service.ts` for real-time order updates.
- Runners join stall rooms; anonymous customers join table rooms.

### Tsconfig
- `target: ES2020`, `module: commonjs`, `strict: true`, `rootDir: ./src`, `outDir: ./dist`.

## Frontend conventions

- **App Router** (`app/`). Three modules: `/admin`, `/runner`, `/ordering`.
- **State:** Zustand with `persist` middleware (`frontend/stores/`). Firebase
  owns session persistence; only the user profile is persisted by Zustand.
- **Styling:** Tailwind CSS v4 + shadcn/ui components (`components/ui/`).
- **API client:** `frontend/lib/api.ts` — all API calls go through `fetchClient<T>()` which handles CORS, error unwrapping, and JSON parsing.
- **Environment:** `.env` defines the backend/WebSocket URLs, the existing
  runner code, and the local Firebase Web App configuration.
- **Tsconfig:** `strict: false`, `moduleResolution: Bundler`, `@/*` → `./*`, `@types/*` → `../types/*`.
- **Lint:** `next/core-web-vitals` via flat ESLint config.

## Gotchas

- `.env` files contain secrets and are gitignored but **do exist in both `backend/` and `frontend/`** — do not delete them.
- Frontend imports types from `../../types` (relative) in some files despite the `@types/*` alias; both patterns work.
- Run `npm install` locally in each package before type checking or building.
- The root `node_modules/` is mostly unused — each sub-package has its own `package.json` and `node_modules/`.
- No CI/CD, no lint-staged, no pre-commit hooks.
- `frontend/components.json` is the shadcn/ui config file — do not delete it.
