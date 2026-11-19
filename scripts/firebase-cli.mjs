// Reuse an ephemeral gcloud access token; no service account key is needed.
import { execSync, spawn } from 'node:child_process';
const token = execSync('gcloud auth print-access-token --account=dgvolunteerswitchboard@gmail.com', {encoding: 'utf8'}).trim();
const child = spawn(process.execPath, ['.deployment-tools/node_modules/firebase-tools/lib/bin/firebase.js', ...process.argv.slice(2)], {
  stdio: 'inherit', env: {...process.env, FIREBASE_TOKEN: token, GOOGLE_CLOUD_QUOTA_PROJECT: 'project-351f7874-1aa0-446d-a21'},
});
child.on('exit', code => process.exit(code ?? 1));
