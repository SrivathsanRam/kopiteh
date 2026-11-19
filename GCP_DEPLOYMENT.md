# Kopiteh Firebase and Google Cloud deployment

This branch targets project `project-351f7874-1aa0-446d-a21` in Singapore. The
frontend runs on Firebase App Hosting, the Express API runs on Cloud Run, and
Firestore plus Cloud Storage replace PostgreSQL and Supabase Storage.

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
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:$serviceAccount" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:$serviceAccount" --role="roles/firebaseauth.admin"
gcloud projects add-iam-policy-binding $projectId --member="serviceAccount:$serviceAccount" --role="roles/storage.objectAdmin"
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
  --allow-unauthenticated `
  --min 0 `
  --max 1 `
  --cpu 1 `
  --memory 512Mi `
  --set-env-vars "FIREBASE_PROJECT_ID=$projectId,FIREBASE_STORAGE_BUCKET=$projectId.firebasestorage.app,FRONTEND_URL=*" `
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
