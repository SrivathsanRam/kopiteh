// Run with node scripts/gcp-api.mjs <action>. Tokens stay in memory.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export const project = 'project-351f7874-1aa0-446d-a21';
export const region = 'asia-southeast1';
export const token = execSync('gcloud auth print-access-token --account=dgvolunteerswitchboard@gmail.com', { encoding: 'utf8' }).trim();
export async function api(url, method = 'GET', body, allow404 = false) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (response.status === 404 && allow404) return null;
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
export async function waitOperation(host, operation) {
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    operation = await api(`${host}/${operation.name}`);
  }
  if (operation.error) throw new Error(JSON.stringify(operation.error));
  return operation.response;
}
const firebase = 'https://firebase.googleapis.com/v1beta1';
const auth = 'https://identitytoolkit.googleapis.com/admin/v2';
const secrets = 'https://secretmanager.googleapis.com/v1';
const action = process.argv[2];
if (action === 'status') {
  console.log(JSON.stringify(await api(`${firebase}/projects/${project}`), null, 2));
} else if (action === 'auth-domains') {
  const config = await api(`${auth}/projects/${project}/config`);
  const domain = `kopiteh-web--${project}.${region}.hosted.app`;
  const domains = [...new Set([...(config.authorizedDomains || []), domain])];
  await api(`${auth}/projects/${project}/config?updateMask=authorizedDomains`, 'PATCH', {authorizedDomains: domains});
  console.log('Firebase Auth authorized domains:', domains);
} else if (action === 'web-config') {
  const apps = await api(`${firebase}/projects/${project}/webApps`);
  const app = apps.apps.find(app => app.displayName === 'Kopiteh');
  const config = await api(`${firebase}/${app.name}/config`);
  console.log(JSON.stringify(config, null, 2));
} else if (action === 'runner-secret') {
  const name = `projects/${project}/secrets/kopiteh-runner-code`;
  let secret = await api(`${secrets}/${name}`, 'GET', undefined, true);
  if (!secret) secret = await api(`${secrets}/projects/${project}/secrets?secretId=kopiteh-runner-code`, 'POST', {replication: {automatic: {}}});
  const versions = await api(`${secrets}/${name}/versions`);
  if (!versions.versions?.length) {
    const value = randomBytes(12).toString('base64url');
    await api(`${secrets}/${name}:addVersion`, 'POST', {payload: {data: Buffer.from(value).toString('base64')}});
  }
  console.log('Runner code ready in Secret Manager.');
} else if (action === 'firebase') {
  let resource = await api(`${firebase}/projects/${project}`, 'GET', undefined, true);
  if (!resource) resource = await waitOperation(firebase, await api(`${firebase}/projects/${project}:addFirebase`, 'POST', {}));
  console.log(JSON.stringify(resource, null, 2));
} else if (action === 'resources') {
  console.log('Bucket:', JSON.stringify(await api(`https://firebasestorage.googleapis.com/v1alpha/projects/${project}/defaultBucket`, 'POST', { location: region })));
  let config = await api(`${auth}/projects/${project}/config`, 'GET', undefined, true);
  if (!config) {
    await api(`https://identitytoolkit.googleapis.com/v2/projects/${project}/identityPlatform:initializeAuth`, 'POST', {});
    config = await api(`${auth}/projects/${project}/config`);
  }
  const updated = await api(`${auth}/projects/${project}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, 'PATCH', { signIn: { email: { enabled: true, passwordRequired: true } } });
  console.log('Email/password enabled:', updated.signIn?.email);
  let apps = await api(`${firebase}/projects/${project}/webApps`);
  let app = apps.apps?.find(app => app.displayName === 'Kopiteh');
  if (!app) app = await waitOperation(firebase, await api(`${firebase}/projects/${project}/webApps`, 'POST', {displayName: 'Kopiteh'}));
  console.log('Web app:', app.appId);
} else if (action === 'secret') {
  const name = `projects/${project}/secrets/kopiteh-admin-signup-code`;
  let secret = await api(`${secrets}/${name}`, 'GET', undefined, true);
  if (!secret) {
    secret = await api(`${secrets}/projects/${project}/secrets?secretId=kopiteh-admin-signup-code`, 'POST', { replication: { automatic: {} } });
  }
  const versions = await api(`${secrets}/${name}/versions`);
  if (!versions.versions?.length) {
    const value = randomBytes(32).toString('base64url');
    const version = await api(`${secrets}/${name}:addVersion`, 'POST', {payload: {data: Buffer.from(value).toString('base64')}});
    console.log('Created random admin signup secret:', version.name);
  } else console.log('Admin signup secret already exists.');
} else if (action === 'rules') {
  const host = 'https://firebaserules.googleapis.com/v1';
  for (const [file, release] of [['firestore.rules', 'cloud.firestore'], ['storage.rules', `firebase.storage/${project}.firebasestorage.app`]]) {
    const ruleset = await api(`${host}/projects/${project}/rulesets`, 'POST', { source: {files: [{name: file, content: readFileSync(file, 'utf8')}] } });
    const name = `projects/${project}/releases/${release}`;
    const existing = await api(`${host}/${name}`, 'GET', undefined, true);
    const body = {name, rulesetName: ruleset.name};
    const result = existing ? await api(`${host}/${name}`, 'PATCH', {release: body}) : await api(`${host}/projects/${project}/releases`, 'POST', body);
    console.log('Released rules:', result.name);
  }
}
