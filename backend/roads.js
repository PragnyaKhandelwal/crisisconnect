// Real road distances + drive-time ETAs from an OSRM server (public demo server by default).
// Falls back to straight-line distance until/unless road data arrives, so the app never blocks on it.
const { haversineKm, setDistance } = require('./prioritizer');

const cache = new Map(); // "depot|request|coords" -> { km, min }
const inflight = new Set();
let backoffUntil = 0, lastOk = null;

const url = () => process.env.OSRM_URL || 'https://router.project-osrm.org';
const key = (d, r) => `${d.id}|${r.id}|${d.lat},${d.lng}|${r.lat},${r.lng}`;

setDistance(
  (r, d) => cache.get(key(d, r))?.km ?? haversineKm(r, d),
  (r, d) => cache.get(key(d, r))?.min ?? null,
);

async function fetchChunk(depots, reqs) {
  const coords = [...depots, ...reqs].map(p => `${p.lng},${p.lat}`).join(';');
  const src = depots.map((_, i) => i).join(';');
  const dst = reqs.map((_, i) => depots.length + i).join(';');
  const res = await fetch(`${url()}/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`, { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (j.code !== 'Ok') throw new Error('osrm: ' + (j.code || res.status));
  depots.forEach((d, i) => reqs.forEach((r, k) => {
    const m = j.distances?.[i]?.[k], s = j.durations?.[i]?.[k];
    if (m != null && s != null) cache.set(key(d, r), { km: +(m / 1000).toFixed(2), min: s / 60 });
  }));
}

// Fetch road data for every open request x depot pair we don't have yet. Non-blocking.
async function ensure(state, onUpdate) {
  if (Date.now() < backoffUntil) return;
  const depots = state.depots;
  const todo = state.requests.filter(r => r.status === 'open' && depots.some(d => !cache.has(key(d, r))) && !inflight.has(r.id));
  if (!todo.length || !depots.length) return;
  todo.forEach(r => inflight.add(r.id));
  try {
    const per = Math.max(1, 90 - depots.length); // demo server allows ~100 coordinates per call
    for (let i = 0; i < todo.length; i += per) await fetchChunk(depots, todo.slice(i, i + per));
    lastOk = Date.now(); onUpdate && onUpdate();
  } catch (e) {
    backoffUntil = Date.now() + 60000; // don't hammer a failing server; straight-line is used meanwhile
    console.error('road routing unavailable, using straight-line distance:', e.message);
  } finally { todo.forEach(r => inflight.delete(r.id)); }
}

const status = () => ({ pairs: cache.size, live: lastOk != null && Date.now() >= backoffUntil });

module.exports = { ensure, status, cache };
