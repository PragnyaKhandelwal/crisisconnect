// Zero-dependency HTTP server: REST API + live SSE stream + static frontend.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./data');
const { TYPE_INFO, allocateAll, metrics } = require('./prioritizer');
const { triage } = require('./triage');
const auth = require('./auth');
const roads = require('./roads');
const sms = require('./sms');

const { state } = store;
const PORT = process.env.PORT || 3000;
const FRONT = path.join(__dirname, '..', 'frontend');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise((ok, fail) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
});

const readForm = req => new Promise(ok => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => ok(Object.fromEntries(new URLSearchParams(s))));
});
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
// Coordinator-only actions: dispatching and inventory changes.
const deny = (req, res) => (auth.authorized(req) ? false : (json(res, 401, { error: 'Coordinator login required' }), true));

// ---- live updates (Server-Sent Events) ----
const clients = new Set();
setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 15000).unref(); // keeps proxies from closing the stream
const broadcast = () => clients.forEach(c => c.write(`data: ${Date.now()}\n\n`));

const done = async () => { await store.durable(); broadcast(); roads.ensure(state, broadcast); }; // respond only once data is stored

// ---- derived view: ranked requests + global plan ----
function snapshot() {
  const now = Date.now();
  const plan = allocateAll(state.requests, state.depots, now);
  const rows = state.requests.map(r => ({ ...r, typeLabel: TYPE_INFO[r.type].label, ...(plan.byId.get(r.id) || {}) }))
    .sort((a, b) => (a.status === 'open') !== (b.status === 'open') ? (a.status === 'open' ? -1 : 1) : (a.rank || 1e9) - (b.rank || 1e9) || b.createdAt - a.createdAt);
  const open = rows.filter(r => r.status === 'open');
  const by = f => open.filter(f).length;
  const need = open.reduce((n, r) => n + r.need, 0), got = open.reduce((n, r) => n + r.allocated, 0);
  const fifo = allocateAll(state.requests, state.depots, now, 'fifo');
  return {
    compare: { ai: metrics(plan), fifo: metrics(fifo) },
    routing: roads.status(),
    requests: rows,
    depots: state.depots.map(d => ({ ...d, remaining: plan.remaining[d.id], volunteersLeft: plan.volunteersLeft[d.id] })),
    stats: {
      open: open.length, critical: by(r => r.priority === 'CRITICAL'), high: by(r => r.priority === 'HIGH'),
      people: open.reduce((n, r) => n + r.people, 0),
      covered: by(r => r.coverage === 'covered'), partial: by(r => r.coverage === 'partial'), unmet: by(r => r.coverage === 'unmet'),
      dispatched: rows.filter(r => r.status === 'dispatched').length,
      units: { need, allocated: got },
    },
  };
}

function validate(b) {
  const people = parseInt(b.people, 10), urgency = Math.min(5, Math.max(1, parseInt(b.urgency, 10) || 3));
  const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
  if (!TYPE_INFO[b.type] || !(people > 0) || isNaN(lat) || isNaN(lng)) return null;
  return { type: b.type, people: Math.min(people, 100000), urgency, lat, lng, note: String(b.note || '').slice(0, 200) };
}

// Commit one request's planned assignments: deduct stock, mark dispatched.
function commit(plan, id) {
  const p = plan.byId.get(id), r = state.requests.find(x => x.id === id);
  if (!p || !r) return false;
  p.assignments.forEach(a => { state.depots.find(d => d.id === a.depotId).stock[r.type] -= a.qty; });
  if (p.volunteer) state.depots.find(d => d.id === p.volunteer.depotId).volunteers--;
  r.status = 'dispatched'; r.dispatchedAt = Date.now();
  return true;
}

async function api(req, res, url) {
  const m = req.method;
  if (m === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key', 'Access-Control-Allow-Methods': 'GET,POST' });
    return res.end();
  }
  if (url === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n'); clients.add(res);
    return req.on('close', () => clients.delete(res));
  }
  if (m === 'GET') {
    const s = snapshot();
    if (url === '/api/state') return json(res, 200, s);
    if (url === '/api/requests') return json(res, 200, s.requests);
    if (url === '/api/depots') return json(res, 200, s.depots);
    if (url === '/api/stats') return json(res, 200, s.stats);
    if (url === '/api/me') return json(res, 200, { authRequired: auth.enabled(), loggedIn: auth.enabled() && auth.authorized(req) });
  }
  if (m !== 'POST') return json(res, 404, { error: 'unknown route' });

  if (url === '/api/login') {
    const r = auth.login(clientIp(req), (await readBody(req)).password);
    return r.ok ? json(res, 200, { token: r.token }) : json(res, r.status, { error: r.error });
  }
  if (url === '/api/sms') { // Twilio SMS / WhatsApp webhook
    const params = await readForm(req);
    if (!sms.signatureOk(req, params)) { res.writeHead(403); return res.end('bad signature'); }
    const xml = await sms.handle(params, {
      triage,
      create: async fields => { const r = store.add(fields); await done(); return snapshot().requests.find(x => x.id === r.id); },
    });
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(xml);
  }
  if (url === '/api/requests') {
    const v = validate(await readBody(req));
    if (!v) return json(res, 400, { error: 'type, people, lat, lng required' });
    const r = store.add(v); await done();
    return json(res, 201, snapshot().requests.find(x => x.id === r.id));
  }
  if (url === '/api/triage') { // free text -> structured request
    const b = await readBody(req);
    if (!b.text || isNaN(parseFloat(b.lat)) || isNaN(parseFloat(b.lng))) return json(res, 400, { error: 'text, lat, lng required' });
    const t = await triage(String(b.text).slice(0, 500));
    const r = store.add({ type: t.type, people: t.people, urgency: t.urgency, lat: +b.lat, lng: +b.lng, note: t.note });
    await done();
    return json(res, 201, { ...snapshot().requests.find(x => x.id === r.id), source: t.source });
  }
  if (url === '/api/admin/clear') {
    // wipe all requests (keeps depots); coordinator only, and only when ADMIN_KEY is configured
    if (!auth.enabled()) return json(res, 403, { error: 'forbidden' });
    if (deny(req, res)) return;
    state.requests = []; state.seq = 100; store.save(); await done();
    return json(res, 200, { ok: true });
  }
  if ((url === '/api/demo' || url === '/api/reset') && !process.env.ENABLE_DEMO_API) return json(res, 403, { error: 'disabled' });
  if (url === '/api/demo') {
    const b = await readBody(req);
    store.generateDemo(Math.min(200, parseInt(b.count, 10) || 50)); await done();
    return json(res, 200, { ok: true });
  }
  if (url === '/api/reset') { store.reset(false); await done(); return json(res, 200, { ok: true }); }
  if (url === '/api/dispatch-all') {
    if (deny(req, res)) return;
    const plan = allocateAll(state.requests, state.depots);
    let n = 0;
    for (const [id, p] of plan.byId) if (p.allocated > 0 && commit(plan, id)) n++;
    store.save(); await done();
    return json(res, 200, { ok: true, dispatched: n });
  }
  if (url === '/api/depots') { // register a real depot
    if (deny(req, res)) return;
    const b = await readBody(req), lat = parseFloat(b.lat), lng = parseFloat(b.lng);
    if (!b.name || isNaN(lat) || isNaN(lng)) return json(res, 400, { error: 'name, lat, lng required' });
    const n = v => Math.max(0, parseInt(v, 10) || 0), st = b.stock || {};
    state.depots.push({ id: 'D' + (Date.now() % 1e6), name: String(b.name).slice(0, 60), lat, lng, volunteers: n(b.volunteers),
      stock: { water: n(st.water), food: n(st.food), blankets: n(st.blankets), medical: n(st.medical) } });
    store.save(); await done();
    return json(res, 201, { ok: true });
  }
  const sm = url.match(/^\/api\/depots\/([\w-]+)$/);
  if (sm) { // update a depot's real inventory
    if (deny(req, res)) return;
    const d = state.depots.find(x => x.id === sm[1]);
    if (!d) return json(res, 404, { error: 'not found' });
    const b = await readBody(req), n = v => Math.max(0, parseInt(v, 10) || 0);
    for (const k of ['water', 'food', 'blankets', 'medical']) if (b.stock && b.stock[k] !== undefined) d.stock[k] = n(b.stock[k]);
    if (b.volunteers !== undefined) d.volunteers = n(b.volunteers);
    store.save(); await done();
    return json(res, 200, { ok: true });
  }
  const dm = url.match(/^\/api\/requests\/(\d+)\/dispatch$/);
  if (dm) {
    if (deny(req, res)) return;
    const id = +dm[1], r = state.requests.find(x => x.id === id);
    if (!r) return json(res, 404, { error: 'not found' });
    if (r.status !== 'open') return json(res, 409, { error: 'already dispatched' });
    const plan = allocateAll(state.requests, state.depots);
    if (!plan.byId.get(id).allocated) return json(res, 409, { error: 'no supply available' });
    commit(plan, id); store.save(); await done();
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'unknown route' });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url.startsWith('/api/')) return await api(req, res, url);
    const file = path.normalize(path.join(FRONT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(FRONT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) { if (!res.headersSent) json(res, 500, { error: 'server error: ' + e.message }); }
});

if (require.main === module) store.ready.then(() => { roads.ensure(state, broadcast); return server.listen(PORT, () => console.log(`CrisisConnect running at http://localhost:${PORT} (storage: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON file'})`)); }, e => { console.error('Database init failed:', e.message); process.exit(1); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => store.durable().catch(() => {}).finally(() => process.exit(0)));
module.exports = { server, snapshot };
