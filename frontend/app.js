const API = location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
const COLORS = { medical: '#ef4444', water: '#f97316', food: '#eab308', blankets: '#3b82f6' };
const UNITS = { medical: 'teams', water: 'L water', food: 'meals', blankets: 'blankets' };

const map = L.map('map').setView([28.63, 77.2], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
const layer = L.layerGroup().addTo(map), routes = L.layerGroup().addTo(map);
let picked = null, pickMarker = null, data = null, selected = null, filter = 'all';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = '', coord = false, authRequired = false;
try { token = localStorage.getItem('cc_token') || ''; } catch { /* storage blocked */ }
const saveToken = t => { token = t; try { t ? localStorage.setItem('cc_token', t) : localStorage.removeItem('cc_token'); } catch { /* ignore */ } };
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(b || {}) });

map.on('click', e => {
  picked = e.latlng;
  $('loc').textContent = `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`;
  if (pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.marker(picked).addTo(map);
});

async function refresh() {
  data = await (await fetch(API + '/state')).json();
  render();
}

function render() {
  const { requests, depots, stats } = data;
  const total = requests.length, open = requests.filter(r => r.status === 'open');
  const pct = stats.units.need ? Math.round(100 * stats.units.allocated / stats.units.need) : 100;

  $('pipeline').innerHTML = [
    [total, 'emergency requests'], ['AI', 'triage + scoring'], [stats.critical + stats.high, 'critical / high incidents'],
    [depots.length, 'depots with resources'], [pct + '%', `demand covered (${stats.covered} full, ${stats.partial} partial)`],
  ].map(([b, s]) => `<div class="step"><b>${b}</b><span>${s}</span></div>`).join('');

  const {ai, fifo} = data.compare, dl = (x, y, inv) => { const d = +(x - y).toFixed(1); return d === 0 ? '' : '<em class="' + ((d > 0) !== !!inv ? 'up' : 'dn') + '">' + (d > 0 ? '+' : '') + d + '</em>'; };
  $('compare').innerHTML = '<h2>AI plan vs first-come-first-served</h2><table><tr><th></th><th>People helped</th><th>Critical fully served</th><th>Avg supply distance</th></tr>' +
    '<tr><td>First-come-first-served</td><td>' + fifo.peopleHelped + '</td><td>' + fifo.criticalServed + ' / ' + fifo.criticalTotal + '</td><td>' + fifo.avgKm + ' km</td></tr>' +
    '<tr class="ai"><td>CrisisConnect AI</td><td>' + ai.peopleHelped + dl(ai.peopleHelped, fifo.peopleHelped) + '</td><td>' + ai.criticalServed + ' / ' + ai.criticalTotal + dl(ai.criticalServed, fifo.criticalServed) + '</td><td>' + ai.avgKm + ' km' + dl(ai.avgKm, fifo.avgKm, true) + '</td></tr></table>';

  $('stats').innerHTML = [
    ['Open requests', stats.open], ['Critical', stats.critical], ['People waiting', stats.people],
    ['Unmet (need resupply)', stats.unmet], ['Dispatched', stats.dispatched],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  // editable inventory; don't redraw while the user is typing in one of the boxes
  const dis = coord ? '' : 'disabled title="Coordinator login required"';
  if (!document.activeElement?.dataset?.k) {
    const cell = (d, k, label, val, after) => `<div>${label}<br><input class="sm" type="number" min="0" data-d="${d.id}" data-k="${k}" value="${val}" ${dis}><br><span class="muted">${after}</span></div>`;
    $('depots').innerHTML = depots.map(d => `
      <div class="depot"><div><b>${esc(d.name)}</b><br><span class="muted">volunteer teams</span><br><input class="sm" type="number" min="0" data-d="${d.id}" data-k="volunteers" value="${d.volunteers}" ${dis}></div>
      ${['water', 'food', 'blankets', 'medical'].map(k => cell(d, k, k, d.stock[k], 'after plan: ' + d.remaining[k])).join('')}</div>`).join('')
      || '<p class="hint">No depots yet. Add one below.</p>';
  }

  layer.clearLayers();
  depots.forEach(d => L.circleMarker([d.lat, d.lng], { radius: 11, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: .9 })
    .bindPopup(`<b>${esc(d.name)}</b><br>Water ${d.stock.water} L · Food ${d.stock.food} · Blankets ${d.stock.blankets} · Medical ${d.stock.medical}`).addTo(layer));
  open.forEach(r => L.circleMarker([r.lat, r.lng], { radius: 6 + Math.min(r.people / 6, 9), color: COLORS[r.type], fillColor: COLORS[r.type], fillOpacity: .65, weight: r.id === selected ? 4 : 1 })
    .bindTooltip(`#${r.id} ${r.typeLabel} · ${r.people} people · ${r.priority}`).on('click', () => select(r.id)).addTo(layer));
  drawRoutes();
  $('routing').textContent = data.routing && data.routing.live ? '🛣 Road distances & drive-time ETAs (OSRM)' : 'Straight-line distances (road data unavailable)';

  const shown = requests.filter(r => filter === 'all' || (filter === 'dispatched' ? r.status === 'dispatched'
    : filter === 'unmet' ? r.coverage === 'unmet' && r.status === 'open' : r.priority === filter && r.status === 'open'));
  $('queue').innerHTML = shown.slice(0, 120).map(card).join('') || '<p class="hint">No requests.</p>';
}

function card(r) {
  const done = r.status !== 'open';
  const bd = r.breakdown ? Object.entries(r.breakdown).map(([k, v]) => `<div>${k}<span class="bar"><i style="width:${Math.min(100, v * 2.5)}%"></i></span>${v}</div>`).join('') : '';
  return `<div class="req ${done ? 'done' : ''} ${r.id === selected ? 'sel' : ''}" data-id="${r.id}" style="border-left-color:${COLORS[r.type]}">
    <h3><span>#${r.id} · ${esc(r.typeLabel)}${!done ? `<span class="tag ${r.coverage}">${r.coverage}</span>` : ''}</span>
      <span class="badge ${done ? 'DISPATCHED' : r.priority}">${done ? 'DISPATCHED' : `${r.priority} · ${r.score}`}</span></h3>
    <div class="meta">${r.people} people${r.note ? ' · ' + esc(r.note) : ''}${done ? '' : `<br>${r.distanceKm} km from supply · needs ${r.need} ${UNITS[r.type]}`}</div>
    ${done ? '' : `<ul>${r.plan.map(p => `<li>${esc(p)}</li>`).join('')}</ul><div class="why"><b>Why this priority:</b>${bd}</div>
      ${r.allocated ? `<button class="coord-only" data-dispatch="${r.id}">Approve &amp; dispatch</button>` : ''}`}
  </div>`;
}

function drawRoutes() {
  routes.clearLayers();
  const r = data.requests.find(x => x.id === selected && x.status === 'open');
  if (!r) return;
  r.assignments.forEach(a => {
    const d = data.depots.find(x => x.id === a.depotId);
    L.polyline([[d.lat, d.lng], [r.lat, r.lng]], { color: '#22c55e', weight: 3, dashArray: '6 6' }).bindTooltip(`${a.qty} ${UNITS[r.type]} · ${a.km} km`).addTo(routes);
  });
}

function select(id) {
  selected = selected === id ? null : id;
  render();
  const r = data.requests.find(x => x.id === selected);
  if (r) { map.panTo([r.lat, r.lng]); document.querySelector(`.req[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); }
}

$('queue').addEventListener('click', async e => {
  const btn = e.target.closest('[data-dispatch]');
  if (btn) { e.stopPropagation(); const j = await send(`/requests/${btn.dataset.dispatch}/dispatch`); return j && toast('Dispatched: stock deducted from depots.'); }
  const c = e.target.closest('.req');
  if (c) select(+c.dataset.id);
});
$('filters').addEventListener('click', e => {
  if (!e.target.dataset.f) return;
  filter = e.target.dataset.f;
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b === e.target));
  render();
});

// ---- actions: always re-fetch after a change so the UI never depends on the live stream ----
let toastTimer;
function toast(msg, bad) {
  const t = $('toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 7000);
}
async function send(path, body) {
  try {
    const res = await post(path, body), j = await res.json().catch(() => ({}));
    if (res.status === 401) { saveToken(''); setCoord(false); toast('Coordinator login required.', true); $('login').showModal(); return null; }
    if (!res.ok) { toast(j.error || 'Request failed', true); return null; }
    await refresh();
    return j;
  } catch { toast('Cannot reach the server. Check your connection.', true); return null; }
}

$('btn-all').onclick = async () => {
  if (!confirm('Dispatch the full plan? This deducts stock from depots.')) return;
  const j = await send('/dispatch-all');
  if (j) toast(`Dispatched ${j.dispatched} requests.`);
};
$('depots').addEventListener('change', async e => {
  const d = e.target.dataset;
  if (!d.d) return;
  const v = Math.max(0, parseInt(e.target.value, 10) || 0);
  await send('/depots/' + d.d, d.k === 'volunteers' ? { volunteers: v } : { stock: { [d.k]: v } });
});
$('depot-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!picked) return toast('Set a location first (click the map, search, or use GPS).', true);
  const f = Object.fromEntries(new FormData(e.target));
  const j = await send('/depots', { name: f.name, lat: picked.lat, lng: picked.lng, volunteers: f.volunteers, stock: f });
  if (j) { e.target.reset(); toast('Depot added.'); }
});

// ---- location: map click, address search (OpenStreetMap Nominatim) or device GPS ----
function setPicked(lat, lng, zoom) {
  picked = { lat, lng };
  $('loc').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  if (pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.marker(picked).addTo(map);
  if (zoom) map.setView(picked, zoom);
}
map.off('click');
map.on('click', e => setPicked(e.latlng.lat, e.latlng.lng));
$('geo').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const q = new FormData(e.target).get('q');
    const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q))).json();
    if (!r.length) return toast('Address not found. Try a broader name or click the map.', true);
    setPicked(+r[0].lat, +r[0].lon, 15); toast('Location set: ' + r[0].display_name.slice(0, 80));
  } catch { toast('Address search failed. Click the map instead.', true); }
});
$('btn-gps').onclick = () => {
  if (!navigator.geolocation) return toast('GPS not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(p => { setPicked(p.coords.latitude, p.coords.longitude, 15); toast('Using your current location.'); },
    () => toast('Could not get your location. Allow location access or click the map.', true), { enableHighAccuracy: true, timeout: 10000 });
};

// ---- submitting requests: show the result immediately ----
function showResult(r) {
  if (!r) return;
  const p = r.plan?.[0] || 'No supply available: escalate for resupply';
  toast(`Request #${r.id} added: ${r.priority} (score ${r.score}, rank ${r.rank}). ${p}`);
  filter = 'all'; document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === 'all'));
  selected = r.id; render();
  map.panTo([r.lat, r.lng]);
  document.querySelector(`.req[data-id="${r.id}"]`)?.scrollIntoView({ block: 'center' });
}
$('triage').addEventListener('submit', async e => {
  e.preventDefault();
  if (!picked) return toast('Set the location first (click the map, search an address, or use GPS).', true);
  const r = await send('/triage', { text: new FormData(e.target).get('text'), ...picked });
  if (r) { e.target.reset(); showResult(r); }
});
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!picked) return toast('Set the location first (click the map, search an address, or use GPS).', true);
  const r = await send('/requests', { ...Object.fromEntries(new FormData(e.target)), ...picked });
  if (r) { e.target.reset(); showResult(r); }
});

// ---- live: server push + polling fallback ----
const es = new EventSource(API + '/stream');
es.onopen = () => $('live').classList.add('on');
es.onerror = () => $('live').classList.remove('on');
es.onmessage = () => refresh().catch(() => {});
// ---- coordinator login ----
function setCoord(v) {
  coord = v; document.body.classList.toggle('coord', v);
  const b = $('btn-login'); b.hidden = !authRequired; b.textContent = v ? 'Log out' : 'Coordinator login';
  if (data) { document.activeElement?.blur?.(); render(); }
}
async function checkMe() {
  try {
    const r = await (await fetch(API + '/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} })).json();
    authRequired = r.authRequired; setCoord(!r.authRequired || r.loggedIn);
  } catch { /* offline: stay read-only */ }
}
$('btn-login').onclick = () => { if (coord) { saveToken(''); setCoord(false); toast('Logged out.'); } else $('login').showModal(); };
$('login-cancel').onclick = () => $('login').close();
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const res = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return toast(j.error || 'Login failed', true);
  saveToken(j.token); $('pw').value = ''; $('login').close(); await checkMe(); toast('Logged in as coordinator.');
});
checkMe();
refresh().catch(() => toast('Cannot reach the server.', true));
setInterval(() => refresh().catch(() => {}), 5000);
