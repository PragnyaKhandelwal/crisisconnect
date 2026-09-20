// Persistent store (JSON file) with seed + demo generator.
const fs = require('fs');
const path = require('path');
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const seedDepots = () => [
  { id: 'D1', name: 'Central Relief Depot', lat: 28.6139, lng: 77.2090, volunteers: 4, stock: { water: 360, food: 200, blankets: 64, medical: 3 } },
  { id: 'D2', name: 'North Community Hall', lat: 28.7041, lng: 77.1025, volunteers: 3, stock: { water: 200, food: 120, blankets: 36, medical: 2 } },
  { id: 'D3', name: 'East School Shelter', lat: 28.6280, lng: 77.3049, volunteers: 3, stock: { water: 240, food: 60, blankets: 80, medical: 1 } },
  { id: 'D4', name: 'South Sports Complex', lat: 28.5300, lng: 77.2200, volunteers: 2, stock: { water: 160, food: 140, blankets: 32, medical: 2 } },
];

const state = { depots: seedDepots(), requests: [], seq: 100 };

// Storage: PostgreSQL when DATABASE_URL is set (real, durable), else a local JSON file.
let pool = null;
const usePg = !!process.env.DATABASE_URL;

async function initPg() {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127.0.0.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }, max: 4 });
  await pool.query('CREATE TABLE IF NOT EXISTS depots (id text PRIMARY KEY, data jsonb NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS requests (id integer PRIMARY KEY, status text NOT NULL, created_at bigint NOT NULL, data jsonb NOT NULL)');
  const dep = await pool.query('SELECT data FROM depots');
  const req = await pool.query('SELECT data FROM requests ORDER BY id');
  if (dep.rows.length) state.depots = dep.rows.map(r => r.data);
  state.requests = req.rows.map(r => r.data);
  state.seq = Math.max(100, ...state.requests.map(r => r.id));
  if (!dep.rows.length) await flush(); // first run: store the default depots
}

// Writes are serialized and coalesced: one transaction with 4 statements syncs memory -> Postgres.
// Callers `await durable()` so the API only answers after the data is really stored.
let flushing = Promise.resolve(), queued = false;
function flush() {
  if (queued) return flushing;
  queued = true;
  flushing = flushing.catch(() => {}).then(async () => {
    queued = false;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const dep = state.depots, req = state.requests;
      await c.query('DELETE FROM depots WHERE id <> ALL($1::text[])', [dep.map(d => d.id)]);
      await c.query('INSERT INTO depots (id, data) SELECT * FROM unnest($1::text[], $2::jsonb[]) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [dep.map(d => d.id), dep.map(d => JSON.stringify(d))]);
      await c.query('DELETE FROM requests WHERE id <> ALL($1::int[])', [req.map(r => r.id)]);
      await c.query('INSERT INTO requests (id, status, created_at, data) SELECT * FROM unnest($1::int[], $2::text[], $3::bigint[], $4::jsonb[]) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data',
        [req.map(r => r.id), req.map(r => r.status), req.map(r => r.createdAt), req.map(r => JSON.stringify(r))]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('db write failed:', e.message); throw e; }
    finally { c.release(); }
  });
  flushing.catch(() => {}); // failures are surfaced to whoever awaits durable()
  return flushing;
}
const durable = () => (usePg ? flushing : Promise.resolve());

function load() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { /* fresh start */ }
}
function save() {
  if (usePg) return void flush();
  try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch { /* read-only fs is fine */ }
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES = {
  water: ['No drinking water', 'Well contaminated by flood', 'Taps dry for 2 days'],
  food: ['Families displaced', 'No food since yesterday', 'Kitchen destroyed'],
  blankets: ['Cold nights, roof damaged', 'Sleeping outdoors', 'Lost belongings in flood'],
  medical: ['Injuries, urgent', 'Elderly patient needs insulin', 'Trapped, bleeding', 'Pregnant woman, needs assistance'],
};

function add(fields) {
  const r = { id: ++state.seq, status: 'open', createdAt: Date.now(), ...fields };
  state.requests.push(r); save(); return r;
}

function generateDemo(n = 50, seed = Date.now() % 100000) {
  const rnd = mulberry32(seed), pick = a => a[Math.floor(rnd() * a.length)];
  const hot = [[28.66, 77.23], [28.58, 77.30], [28.69, 77.15], [28.55, 77.15], [28.64, 77.10]];
  const types = ['water', 'water', 'water', 'food', 'food', 'blankets', 'blankets', 'medical'];
  for (let i = 0; i < n; i++) {
    const type = pick(types), [la, ln] = pick(hot);
    add({
      type,
      people: type === 'medical' ? 1 + Math.floor(rnd() * 6) : 5 + Math.floor(rnd() * 55),
      urgency: type === 'medical' ? 4 + Math.round(rnd()) : 1 + Math.floor(rnd() * 5),
      lat: +(la + (rnd() - .5) * .07).toFixed(5), lng: +(ln + (rnd() - .5) * .07).toFixed(5),
      note: pick(NOTES[type]), createdAt: Date.now() - Math.floor(rnd() * 4 * 3600e3),
    });
  }
}

function reset(withDemo = false) {
  state.depots = seedDepots(); state.requests = []; state.seq = 100;
  if (withDemo) generateDemo(50, 42); else save();
}

const ready = usePg ? initPg() : Promise.resolve(load());


module.exports = { ready, durable, state, add, save, generateDemo, reset };
