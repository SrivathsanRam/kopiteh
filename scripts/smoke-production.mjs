// Creates only temporary deployment fixtures, then removes those exact fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { api, project } from './gcp-api.mjs';
const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const { io } = requireFrontend('socket.io-client');
const base = 'https://kopiteh-api-938357880765.asia-southeast1.run.app';
const origin = `https://kopiteh-web--${project}.asia-southeast1.hosted.app`;
const docs = [];
let uid, imageKey, socket;
let idToken;
async function request(path, method = 'GET', body, authenticated = false) {
  const response = await fetch(`${base}/api${path}`, {method, headers: {'Content-Type':'application/json', Origin: origin, ...(authenticated ? {Authorization:`Bearer ${idToken}`} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  assert(response.ok && result.success, `${path}: ${JSON.stringify(result)}`);
  return result.payload.data;
}
function remember(collection, id) { assert(id !== undefined); docs.push(`projects/${project}/databases/(default)/documents/${collection}/${id}`); }
function socketEvent(event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Socket timeout: ${event}`)), 15000);
    socket.once(event, value => {clearTimeout(timer); resolve(value);});
  });
}
try {
  const health = await fetch(`${base}/health`); assert.equal(health.status, 200);
  const unauthorized = await fetch(`${base}/api/venue/create`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Unauthorized'})});
  assert.equal(unauthorized.status, 401);
  const secret = await api(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/kopiteh-admin-signup-code/versions/1:access`);
  const email = `deploy-smoke-${Date.now()}@example.com`;
  const password = `Kopiteh-${randomBytes(18).toString('hex')}9`;
  const signup = await request('/auth/create-account', 'POST', {name:'Deployment smoke test', email, password, secretCode:Buffer.from(secret.payload.data,'base64').toString()});
  uid = signup.user.user_id; remember('users', uid);
  const apps = await api(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`);
  const config = await api(`https://firebase.googleapis.com/v1beta1/${apps.apps.find(a=>a.displayName==='Kopiteh').name}/config`);
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const loginResult=await login.json(); assert(login.ok, JSON.stringify(loginResult.error)); idToken=loginResult.idToken;
  const check=await request('/auth/auth-check','GET',undefined,true); assert.equal(check.isAuthenticated,true);
  console.log('PASS administrator signup, login, claims, and protected-route rejection');
  const venue=await request('/venue/create','POST',{name:'Deployment smoke test'},true); remember('venues',venue.venue_id);
  const table=await request('/tables/create','POST',{venue_id:venue.venue_id,table_number:'SMOKE',is_active:true},true); remember('tables',table.table_id);
  const stall=await request('/stalls/create','POST',{venue_id:venue.venue_id,name:'Deployment smoke stall',is_open:true},true); remember('stalls',stall.stall_id);
  const item=await request('/items/create','POST',{stall_id:stall.stall_id,name:'Deployment smoke item',price:2.5,is_available:true},true); remember('menuItems',item.item_id);
  socket=io(base,{transports:['websocket'],extraHeaders:{Origin:origin},reconnection:false});
  await socketEvent('connect'); socket.emit('join_stall',stall.stall_id); socket.emit('join_table',table.table_id);
  await new Promise(resolve=>setTimeout(resolve,300));
  const newItem=socketEvent('order_item_created');
  const order=await request('/order/create','POST',{table_id:table.table_id,total_price:5,volunteer_name:'Deployment smoke test',items:[{item_id:item.item_id,quantity:2,price:2.5,modifiers:[]}]});remember('orders',order.order_id);
  const event=await newItem; const orderItem=event.orderItem;remember('orderItems',orderItem.order_item_id);
  assert.equal(orderItem.status,'INCOMING');
  for (const expected of ['PREPARING','SERVED']) {
    const updateEvent=socketEvent('order_item_updated');
    await request(`/orderItem/updateStatus/STANDARD/${orderItem.order_item_id}`,'PUT');
    const update=await updateEvent; assert.equal(update.orderItem.status,expected);
  }
  const completed=await request(`/order/${order.order_id}`);assert.equal(completed.status,'COMPLETED');
  console.log('PASS anonymous order, runner status transitions, Firestore persistence, and live WebSocket events');
  const uploaded=await request('/upload/base64','POST',{folder:'deployment-smoke',dataUri:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='},true);
  imageKey=decodeURIComponent(new URL(uploaded.imageUrl).pathname.split('/o/')[1]);
  const image=await fetch(uploaded.imageUrl);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);
  console.log('PASS authenticated image upload and anonymous public image download');
} finally {
  socket?.disconnect();
  if (imageKey) await api(`https://storage.googleapis.com/storage/v1/b/${project}.firebasestorage.app/o/${encodeURIComponent(imageKey)}`, 'DELETE');
  if (docs.length) await api(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, 'POST', {writes:docs.map(name=>({delete:name}))});
  if (uid) await api(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:delete`, 'POST', {localId: uid});
  console.log('Removed only this run\'s temporary deployment fixtures.');
}
