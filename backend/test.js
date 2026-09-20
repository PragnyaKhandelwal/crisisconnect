process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'cc-test-' + process.pid + '.json');
const assert = require('assert');
const { allocateAll, score } = require('./prioritizer');
const { ruleTriage } = require('./triage');
const { state } = require('./data');
const { server } = require('./server');

// Prioritizer
const now = Date.now();
const depots = () => [{ id: 'A', name: 'A', lat: 28.6, lng: 77.2, volunteers: 1, stock: { water: 100, food: 0, blankets: 0, medical: 1 } }];
const med = { id: 1, type: 'medical', people: 2, urgency: 5, lat: 28.61, lng: 77.2, status: 'open', createdAt: now };
const wat = { id: 2, type: 'water', people: 40, urgency: 3, lat: 28.61, lng: 77.2, status: 'open', createdAt: now };
assert(score(med, depots(), now).score > score(wat, depots(), now).score, 'medical outranks water');

// Global allocation never over-commits stock
const many = Array.from({ length: 10 }, (_, i) => ({ ...wat, id: 10 + i }));
const plan = allocateAll(many, depots(), now);
const used = [...plan.byId.values()].reduce((n, p) => n + p.allocated, 0);
assert.strictEqual(used, 100, 'uses exactly the 100 L available');
assert([...plan.byId.values()].some(p => p.coverage === 'unmet'), 'some requests unmet');
assert.strictEqual(plan.remaining.A.water, 0);

// Triage
const t = ruleTriage('Need water - 40 people, children here');
assert.deepStrictEqual([t.type, t.people], ['water', 40]);
assert.strictEqual(ruleTriage('Medical assistance urgent').type, 'medical');

// API end-to-end
server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/api`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  try {
    let s = await (await fetch(base + '/state')).json();
    assert.strictEqual(s.stats.open, 50, '50 demo requests seeded');
    assert(s.requests[0].score >= s.requests[10].score, 'ranked');
    const r = await post('/triage', { text: 'Need blankets for 20 people', lat: 28.6, lng: 77.2 });
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await post('/requests', { type: 'x' })).status, 400);
    const before = s.depots.reduce((n, d) => n + d.stock.water, 0);
    assert.strictEqual((await post('/dispatch-all')).status, 200);
    s = await (await fetch(base + '/state')).json();
    assert(s.depots.reduce((n, d) => n + d.stock.water, 0) < before, 'stock deducted');
    assert.strictEqual(s.stats.open, s.stats.unmet, 'only unmet remain open');
    console.log('ALL TESTS PASSED');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close(); require('fs').rmSync(process.env.DATA_FILE, { force: true }); process.exit();
});
