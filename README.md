# Kopiteh

Kopiteh is a Next.js ordering frontend with an Express API. The deployment on
the `gcp-deployment` branch uses Firebase Authentication, Cloud Firestore, and
Cloud Storage. PostgreSQL is not required.

## Local development

Install dependencies in both packages:

```powershell
cd backend
npm install
cd ../frontend
npm install
```

Copy any missing variables from `backend/.env.example` and
`frontend/.env.example` into the existing `.env` files. Do not delete or commit
the real `.env` files.

Start Firebase emulators from the repository root:

```powershell
npx firebase-tools emulators:start
```

Start the backend and frontend in separate terminals:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm run dev
```

The frontend is available at `http://localhost:3000`; the API health endpoint
is at `http://localhost:4000/health`.

## Production deployment

See [GCP_DEPLOYMENT.md](./GCP_DEPLOYMENT.md) for the Firebase and Cloud Run
setup for project `project-351f7874-1aa0-446d-a21` in Singapore.
