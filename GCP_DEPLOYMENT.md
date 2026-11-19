# Kopiteh Firebase and Google Cloud deployment

This branch targets project `project-351f7874-1aa0-446d-a21` in Singapore. The
frontend runs on Firebase App Hosting, the Express API runs on Cloud Run, and
Firestore plus Cloud Storage replace PostgreSQL and Supabase Storage.

## Live deployment (19 November 2026)

- Frontend: https://kopiteh-web--project-351f7874-1aa0-446d-a21.asia-southeast1.hosted.app
- API: https://kopiteh-api-938357880765.asia-southeast1.run.app
- API health: append `/health` to the API origin.
- Firestore: `(default)`, Standard edition, Native mode, `asia-southeast1`.
- Image bucket: `project-351f7874-1aa0-446d-a21.firebasestorage.app` in Singapore.
- Runtime identity: `kopiteh-api@project-351f7874-1aa0-446d-a21.iam.gserviceaccount.com`.
- Build identity: `kopiteh-build@project-351f7874-1aa0-446d-a21.iam.gserviceaccount.com`.
- Both services use minimum zero and maximum one instance.
- Monthly project budget: S$5, notifications at S$1 and S$5. This is an alert, not a spending cap.

The first release uses Firebase CLI local-source deployments. The deployment
branch is pushed to GitHub, but automatic GitHub rollouts are not connected.
All runtime hosting, database, authentication, secrets and image storage are
Google Cloud/Firebase resources. Local `.env` files are excluded from uploads.

Production verification passed for administrator signup/login/claims,
anonymous ordering, runner status transitions, WebSocket events, image
upload/public download, CORS, blocked direct Firestore access, five frontend
pages and 16 JavaScript assets. Test fixtures were removed. The successful
frontend Cloud Build ID is `7da02bc7-71d2-4312-828e-cda2435894ed`.

### Redeploy the frontend

Authenticate with `gcloud auth login dgvolunteerswitchboard@gmail.com`, then:

```powershell
npm install --prefix .deployment-tools --no-save --package-lock=false firebase-tools@15.37.0
node scripts/firebase-cli.mjs deploy --only=apphosting:kopiteh-web --project=project-351f7874-1aa0-446d-a21 --non-interactive
```

The wrapper obtains a short-lived access token from gcloud and sets the quota
project in memory. No service-account key file is needed. `frontend/apphosting.yaml`
contains public browser configuration and references the runner-code secret.
Next.js standalone tracing stays rooted at `frontend/` so App Hosting finds the
server manifest; shared DTOs in `types/` remain available at build time.

### Administrator and runner setup

Retrieve `kopiteh-admin-signup-code` and `kopiteh-runner-code` from Secret Manager
in this project. Both were randomly generated; neither is committed to Git.
Create your administrator at `/admin/auth/signup`, then add/import venues,
tables and menus. Customer orders do not require login. Runner login keeps its
existing browser code flow; its `NEXT_PUBLIC_` code is necessarily included in
the browser bundle and is not a replacement for server-side authorization.

### Verify production

```powershell
node scripts/smoke-production.mjs
node scripts/verify-frontend.mjs
```

This tests administrator signup/login/claims, protected-route rejection,
anonymous ordering, runner state changes, WebSocket events and public image
uploads. It removes only the exact temporary documents, image and account it
created; numeric counters may advance. It does not send emails.

## 1. Create the Firebase resources

1. Open the Firebase console and add Firebase to the existing Google Cloud
   project `project-351f7874-1aa0-446d-a21`.
2. Upgrade the project to the Blaze plan. The expected traffic remains within
   the no-cost quotas, but App Hosting and Cloud Storage require billing.
3. Create the default Firestore database in Native mode at
   `asia-southeast1` (Singapore). The location cannot be changed later.
4. In Authentication > Sign-in method, enable Email/Password.
5. Register a Firebase Web App. App Hosting uses its app ID to inject the
   browser Firebase configuration during builds.
6. Create the default Storage bucket in Singapore.

Deploy the locked-down Firestore rules and public-read Storage rules:

```powershell
npx firebase-tools use project-351f7874-1aa0-446d-a21
npx firebase-tools deploy --only firestore,storage
```

## 2. Create a service account for the API

```powershell
$projectId = "project-351f7874-1aa0-446d-a21"
$serviceAccount = "kopiteh-api@$projectId.iam.gserviceaccount.com"

gcloud config set project $projectId
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com firebasestorage.googleapis.com identitytoolkit.googleapis.com secretmanager.googleapis.com
gcloud iam service-accounts create kopiteh-api --display-name="Kopiteh Cloud Run API"
gcloud iam service-accounts create kopiteh-build --display-name="Kopiteh Cloud Build"
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:kopiteh-build@$projectId.iam.gserviceaccount.com" --role="roles/run.builder"
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:$serviceAccount" --role="roles/datastore.user"
gcloud iam roles create kopitehAuthUsers --project=$projectId --title="Kopiteh administrator signup" --permissions="firebaseauth.users.create,firebaseauth.users.get,firebaseauth.users.update,firebaseauth.users.delete" --stage=GA
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:$serviceAccount" --role="projects/$projectId/roles/kopitehAuthUsers"
gcloud storage buckets add-iam-policy-binding "gs://$projectId.firebasestorage.app" --member="serviceAccount:$serviceAccount" --role="roles/storage.objectAdmin"
```

Use a long random administrator signup code. Store it in Secret Manager; do not
put it in Git or in an unencrypted deployment command.

```powershell
$secret = Read-Host "Administrator signup code" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $secret).Password
$plain | gcloud secrets create kopiteh-admin-signup-code --data-file=-
Remove-Variable plain, secret
gcloud secrets add-iam-policy-binding kopiteh-admin-signup-code --member="serviceAccount:$serviceAccount" --role="roles/secretmanager.secretAccessor"
```

## 3. Deploy the API

```powershell
gcloud run deploy kopiteh-api `
  --source backend `
  --region asia-southeast1 `
  --service-account $serviceAccount `
  --build-service-account "projects/$projectId/serviceAccounts/kopiteh-build@$projectId.iam.gserviceaccount.com" `
  --allow-unauthenticated `
  --min 0 `
  --max 1 `
  --cpu 1 `
  --memory 512Mi `
  --timeout 3600 `
  --set-env-vars "FIREBASE_PROJECT_ID=$projectId,FIREBASE_STORAGE_BUCKET=$projectId.firebasestorage.app,FRONTEND_URL=https://kopiteh-web--$projectId.asia-southeast1.hosted.app" `
  --set-secrets "ADMIN_SIGNUP_CODE=kopiteh-admin-signup-code:latest"
```

Record the resulting service URL. The frontend needs the URL with `/api`
appended, while both WebSocket variables use the URL without `/api`.

## 4. Deploy the frontend

In Firebase Console > App Hosting:

1. Create a backend in Singapore and connect the GitHub repository.
2. Select `gcp-deployment` as the live branch.
3. Set the monorepo root directory to `frontend`.
4. Link the Firebase Web App created in step 1.
5. Add these environment variables to the App Hosting backend:

```text
NEXT_PUBLIC_API_URL=https://YOUR_CLOUD_RUN_URL/api
NEXT_PUBLIC_WS_URL=https://YOUR_CLOUD_RUN_URL
NEXT_PUBLIC_SOCKET_URL=https://YOUR_CLOUD_RUN_URL
NEXT_PUBLIC_RUNNER_CODE=THE_EXISTING_RUNNER_CODE
```

Trigger a rollout. App Hosting supplies the Firebase web configuration, so its
API key and app ID do not need to be committed.

After App Hosting provides its URL, restrict the Cloud Run `FRONTEND_URL`
variable from `*` to that exact origin.

## 5. First-use checklist

1. Open `/admin/auth/signup` and create the first administrator using the
   Secret Manager signup code.
2. Create venues, tables, stalls, menu categories, items, and modifiers in the
   admin interface or import the existing workbook.
3. Place an anonymous test order and verify it appears immediately on the
   runner page.
4. Move the item through `INCOMING`, `PREPARING`, and `SERVED`; verify the
   table's order-status screen updates.
5. Upload a venue and item image and verify its generated download URL works.
6. Create a billing budget alert. Budget alerts notify; they do not cap spend.

## Local development

Copy, without deleting the existing `.env` files, any missing keys from
`backend/.env.example` and `frontend/.env.example`. Start the emulators from the
repository root and then start each application:

```powershell
npx firebase-tools emulators:start
```

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm run dev
```
