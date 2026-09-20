// AI prioritization + global resource allocation.
// score = severity + urgency + people + distance + supply scarcity + waiting time
const TYPE_INFO = {
  medical:  { label: 'Medical emergency',  color: '#ef4444', base: 10, perPerson: 0, unit: 'team' },
  water:    { label: 'Water shortage',     color: '#f97316', base: 7,  perPerson: 2, unit: 'L' },
  food:     { label: 'Food shortage',      color: '#eab308', base: 5,  perPerson: 3, unit: 'meals' },
  blankets: { label: 'Blankets / shelter', color: '#3b82f6', base: 3,  perPerson: 1, unit: 'blankets' },
};

function haversineKm(a, b) {
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const needed = r => (r.type === 'medical' ? Math.max(1, Math.ceil(r.people / 5)) : r.people * TYPE_INFO[r.type].perPerson);
const tier = s => (s >= 75 ? 'CRITICAL' : s >= 60 ? 'HIGH' : s >= 45 ? 'MEDIUM' : 'LOW');

// Priority score with a human-readable breakdown (explainable).
function score(req, depots, now = Date.now()) {
  const t = TYPE_INFO[req.type], need = needed(req);
  const stocked = depots.filter(d => (d.stock[req.type] || 0) > 0).map(d => haversineKm(req, d)).sort((a, b) => a - b);
  const km = stocked.length ? stocked[0] : 50;
  const total = depots.reduce((n, d) => n + (d.stock[req.type] || 0), 0);
  const scarcity = Math.max(0, 1 - total / Math.max(need * 4, 1)); // supply vs. demand
  const ageHrs = (now - req.createdAt) / 3600e3;
  const parts = {
    severity: t.base * 3,
    urgency: req.urgency * 8,
    people: Math.min(req.people, 100) * 0.4,
    distance: Math.min(km, 30) * 0.6,
    scarcity: scarcity * 10,
    waiting: Math.min(ageHrs, 12),
  };
  const raw = Object.values(parts).reduce((a, b) => a + b, 0);
  const sc = Math.round(Math.min(100, raw));
  return { score: sc, priority: tier(sc), breakdown: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(1)])), km };
}

// Global allocation: serve requests in priority order, each from the nearest depots with
// remaining stock (splitting across depots). Stock is simulated so requests never double-book.
function allocateAll(requests, depots, now = Date.now()) {
  const stock = Object.fromEntries(depots.map(d => [d.id, { ...d.stock }]));
  const vols = Object.fromEntries(depots.map(d => [d.id, d.volunteers || 0]));
  const open = requests.filter(r => r.status === 'open')
    .map(r => ({ r, s: score(r, depots, now) }))
    .sort((a, b) => b.s.score - a.s.score);

  const byId = new Map();
  open.forEach(({ r, s }, i) => {
    const t = TYPE_INFO[r.type], need = needed(r);
    const byDist = depots.map(d => ({ d, km: haversineKm(r, d) })).sort((a, b) => a.km - b.km);
    let left = need; const assignments = [];
    for (const { d, km } of byDist) {
      if (left <= 0) break;
      const q = Math.min(left, stock[d.id][r.type] || 0);
      if (q > 0) { stock[d.id][r.type] -= q; left -= q; assignments.push({ depotId: d.id, depotName: d.name, qty: q, km: +km.toFixed(1) }); }
    }
    const allocated = need - left;
    const farKm = assignments.length ? Math.max(...assignments.map(a => a.km)) : s.km;
    let volunteer = null;
    if (allocated > 0 && (r.type === 'medical' || farKm > 5 || r.people >= 30)) {
      const v = byDist.find(x => vols[x.d.id] > 0);
      if (v) { vols[v.d.id]--; volunteer = { depotId: v.d.id, depotName: v.d.name, km: +v.km.toFixed(1) }; }
    }
    const coverage = allocated === 0 ? 'unmet' : left > 0 ? 'partial' : 'covered';
    const plan = assignments.map(a => r.type === 'medical'
      ? `Dispatch ${a.qty} medical team${a.qty > 1 ? 's' : ''} from ${a.depotName} (${a.km} km)`
      : `Allocate ${a.qty} ${t.unit} from ${a.depotName} (${a.km} km)`);
    if (volunteer) plan.push(`Dispatch volunteer team from ${volunteer.depotName}`);
    if (left > 0) plan.push(`Shortfall: ${left} ${t.unit} - request resupply / escalate`);
    if (s.priority === 'CRITICAL') plan.push('Notify coordinator immediately');
    byId.set(r.id, { ...s, rank: i + 1, need, allocated, shortfall: left, coverage, assignments, volunteer, plan, unit: t.unit, distanceKm: +farKm.toFixed(1) });
  });
  return { byId, remaining: stock, volunteersLeft: vols };
}

module.exports = { TYPE_INFO, haversineKm, needed, score, tier, allocateAll };
