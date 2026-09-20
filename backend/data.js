// Persistent store (JSON file) with seed + demo generator.
const fs = require('fs');
const path = require('path');
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const seedDepots = () => [
  { id: 'D1', name: 'Central Relief Depot', lat: 28.6139, lng: 77.2090, volunteers: 4, stock: { water: 900, food: 500, blankets: 160, medical: 3 } },
  { id: 'D2', name: 'North Community Hall', lat: 28.7041, lng: 77.1025, volunteers: 3, stock: { water: 500, food: 300, blankets: 90, medical: 2 } },
  { id: 'D3', name: 'East School Shelter', lat: 28.6280, lng: 77.3049, volunteers: 3, stock: { water: 600, food: 150, blankets: 200, medical: 1 } },
  { id: 'D4', name: 'South Sports Complex', lat: 28.5300, lng: 77.2200, volunteers: 2, stock: { water: 400, food: 350, blankets: 80, medical: 2 } },
];

const state = { depots: seedDepots(), requests: [], seq: 100 };

function load() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { /* fresh start */ }
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch { /* read-only fs is fine */ } }

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

function reset(withDemo = true) {
  state.depots = seedDepots(); state.requests = []; state.seq = 100;
  if (withDemo) generateDemo(50, 42); else save();
}

load();
if (!state.requests.length) reset(true);

module.exports = { state, add, save, generateDemo, reset };
