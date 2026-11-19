import assert from 'node:assert/strict';
import { api, project } from './gcp-api.mjs';
const origin = `https://kopiteh-web--${project}.asia-southeast1.hosted.app`;
const scripts = new Set();
for (const path of ['/', '/admin/auth/login', '/admin/auth/signup', '/ordering/venue', '/runner/login']) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200, `${path} HTTP status`);
  const html = await response.text();
  assert.match(html, /<html/);
  for (const match of html.matchAll(/<script[^>]*src="([^"]+)"/g)) scripts.add(new URL(match[1], origin).href);
  console.log(`PASS frontend page ${path}`);
}
const bundles = (await Promise.all([...scripts].map(async url => {
  const response = await fetch(url); assert.equal(response.status, 200, 'JavaScript asset'); return response.text();
}))).join('\n');
assert(bundles.includes('https://kopiteh-api-938357880765.asia-southeast1.run.app'), 'Production API origin missing from browser bundle');
assert(bundles.includes(project), 'Production Firebase project missing from browser bundle');
const secret = await api(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/kopiteh-runner-code/versions/1:access`);
assert(bundles.includes(Buffer.from(secret.payload.data, 'base64').toString()), 'Runner code missing from browser bundle');
console.log(`PASS ${scripts.size} JavaScript assets, production API/Firebase settings and generated runner configuration`);
