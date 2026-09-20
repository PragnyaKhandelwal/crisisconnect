const API = location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
const COLORS = { medical: '#ef4444', water: '#f97316', food: '#eab308', blankets: '#3b82f6' };
const UNITS = { medical: 'teams', water: 'L water', food: 'meals', blankets: 'blankets' };

const map = L.map('map').setView([28.63, 77.2], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
const layer = L.layerGroup().addTo(map), routes = L.layerGroup().addTo(map);
let picked = null, pickMarker = null, data = null, selected = null, filter = 'all';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const flash = async res => { if (!res.ok) alert((await res.json()).error || 'Request failed'); };

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

  $('stats').innerHTML = [
    ['Open requests', stats.open], ['Critical', stats.critical], ['People waiting', stats.people],
    ['Unmet (need resupply)', stats.unmet], ['Dispatched', stats.dispatched],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  $('depots').innerHTML = depots.map(d => `
    <div class="depot"><div><b>${esc(d.name)}</b><br><span class="muted">${d.volunteersLeft}/${d.volunteers} volunteer teams</span></div>
    ${['water', 'food', 'blankets', 'medical'].map(k => {
      const p = d.stock[k] ? Math.round(100 * d.remaining[k] / d.stock[k]) : 0;
      return `<div>${k}<br>${d.remaining[k]} / ${d.stock[k]}<div class="bar ${p < 15 ? 'low' : ''}"><i style="width:${p}%"></i></div></div>`;
    }).join('')}</div>`).join('');

  layer.clearLayers();
  depots.forEach(d => L.circleMarker([d.lat, d.lng], { radius: 11, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: .9 })
    .bindPopup(`<b>${esc(d.name)}</b><br>Water ${d.stock.water} L · Food ${d.stock.food} · Blankets ${d.stock.blankets} · Medical ${d.stock.medical}`).addTo(layer));
  open.forEach(r => L.circleMarker([r.lat, r.lng], { radius: 6 + Math.min(r.people / 6, 9), color: COLORS[r.type], fillColor: COLORS[r.type], fillOpacity: .65, weight: r.id === selected ? 4 : 1 })
    .bindTooltip(`#${r.id} ${r.typeLabel} · ${r.people} people · ${r.priority}`).on('click', () => select(r.id)).addTo(layer));
  drawRoutes();

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
      ${r.allocated ? `<button data-dispatch="${r.id}">Approve &amp; dispatch</button>` : ''}`}
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
  if (btn) { e.stopPropagation(); return flash(await post(`/requests/${btn.dataset.dispatch}/dispatch`)); }
  const c = e.target.closest('.req');
  if (c) select(+c.dataset.id);
});
$('filters').addEventListener('click', e => {
  if (!e.target.dataset.f) return;
  filter = e.target.dataset.f;
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b === e.target));
  render();
});
$('btn-demo').onclick = async () => flash(await post('/demo', { count: 50 }));
$('btn-reset').onclick = async () => { selected = null; flash(await post('/reset')); };
$('btn-all').onclick = async () => {
  const res = await post('/dispatch-all'); await flash(res);
};

$('triage').addEventListener('submit', async e => {
  e.preventDefault();
  const loc = picked || { lat: 28.63 + (Math.random() - .5) * .1, lng: 77.2 + (Math.random() - .5) * .1 };
  await flash(await post('/triage', { text: new FormData(e.target).get('text'), ...loc }));
  e.target.reset();
});
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!picked) return alert('Click the map to set the request location first.');
  await flash(await post('/requests', { ...Object.fromEntries(new FormData(e.target)), lat: picked.lat, lng: picked.lng }));
  e.target.reset();
});

// Live updates: server pushes an event on every change; poll as a fallback (also refreshes waiting-time scores).
const es = new EventSource(API + '/stream');
es.onopen = () => { $('live').classList.add('on'); };
es.onerror = () => { $('live').classList.remove('on'); };
es.onmessage = refresh;
refresh();
setInterval(refresh, 30000);
