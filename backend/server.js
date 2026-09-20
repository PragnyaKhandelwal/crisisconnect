// Zero-dependency HTTP server: REST API + live SSE stream + static frontend.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./data');
const { TYPE_INFO, allocateAll } = require('./prioritizer');
const { triage } = require('./triage');

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

// ---- live updates (Server-Sent Events) ----
const clients = new Set();
const broadcast = () => clients.forEach(c => c.write(`data: ${Date.now()}\n\n`));

// ---- derived view: ranked requests + global plan ----
function snapshot() {
  const now = Date.now();
  const plan = allocateAll(state.requests, state.depots, now);
  const rows = state.requests.map(r => ({ ...r, typeLabel: TYPE_INFO[r.type].label, ...(plan.byId.get(r.id) || {}) }))
    .sort((a, b) => (a.status === 'open') !== (b.status === 'open') ? (a.status === 'open' ? -1 : 1) : (a.rank || 1e9) - (b.rank || 1e9) || b.createdAt - a.createdAt);
  const open = rows.filter(r => r.status === 'open');
  const by = f => open.filter(f).length;
  const need = open.reduce((n, r) => n + r.need, 0), got = open.reduce((n, r) => n + r.allocated, 0);
  return {
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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' });
    return res.end();
  }
  if (url === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n'); clients.add(res);
    return req.on('close', () => clients.delete(res));
  }
  if (m === 'GET') {
    const s = snapshot();
    if (url === '/api/state') return json(res, 200, s);
    if (url === '/api/requests') return json(res, 200, s.requests);
    if (url === '/api/depots') return json(res, 200, s.depots);
    if (url === '/api/stats') return json(res, 200, s.stats);
  }
  if (m !== 'POST') return json(res, 404, { error: 'unknown route' });

  if (url === '/api/requests') {
    const v = validate(await readBody(req));
    if (!v) return json(res, 400, { error: 'type, people, lat, lng required' });
    const r = store.add(v); broadcast();
    return json(res, 201, r);
  }
  if (url === '/api/triage') { // free text -> structured request
    const b = await readBody(req);
    if (!b.text || isNaN(parseFloat(b.lat)) || isNaN(parseFloat(b.lng))) return json(res, 400, { error: 'text, lat, lng required' });
    const t = await triage(String(b.text).slice(0, 500));
    const r = store.add({ type: t.type, people: t.people, urgency: t.urgency, lat: +b.lat, lng: +b.lng, note: t.note });
    broadcast();
    return json(res, 201, { ...r, source: t.source });
  }
  if (url === '/api/demo') {
    const b = await readBody(req);
    store.generateDemo(Math.min(200, parseInt(b.count, 10) || 50)); broadcast();
    return json(res, 200, { ok: true });
  }
  if (url === '/api/reset') { store.reset(true); broadcast(); return json(res, 200, { ok: true }); }
  if (url === '/api/dispatch-all') {
    const plan = allocateAll(state.requests, state.depots);
    let n = 0;
    for (const [id, p] of plan.byId) if (p.allocated > 0 && commit(plan, id)) n++;
    store.save(); broadcast();
    return json(res, 200, { ok: true, dispatched: n });
  }
  const dm = url.match(/^\/api\/requests\/(\d+)\/dispatch$/);
  if (dm) {
    const id = +dm[1], r = state.requests.find(x => x.id === id);
    if (!r) return json(res, 404, { error: 'not found' });
    if (r.status !== 'open') return json(res, 409, { error: 'already dispatched' });
    const plan = allocateAll(state.requests, state.depots);
    if (!plan.byId.get(id).allocated) return json(res, 409, { error: 'no supply available' });
    commit(plan, id); store.save(); broadcast();
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
  } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); }
});

if (require.main === module) server.listen(PORT, () => console.log(`CrisisConnect running at http://localhost:${PORT}`));
module.exports = { server, snapshot };
