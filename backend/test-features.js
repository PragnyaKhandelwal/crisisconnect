// Tests: coordinator auth, road routing (against a mock OSRM server), SMS/WhatsApp webhook.
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'cc-feat-' + process.pid + '.json');
process.env.ADMIN_KEY = 'hello123';
process.env.TWILIO_AUTH_TOKEN = 'tok';
process.env.PUBLIC_URL = 'https://example.test';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');

// Mock OSRM /table: every depot->request pair is 10 km / 10 min.
const osrm = http.createServer((req, res) => {
  const m = req.url.match(/^\/table\/v1\/driving\/([^?]+)\?sources=([\d;]+)&destinations=([\d;]+)/);
  const s = m[2].split(';').length, d = m[3].split(';').length;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 'Ok', distances: Array(s).fill(Array(d).fill(10000)), durations: Array(s).fill(Array(d).fill(600)) }));
});

osrm.listen(0, () => {
  process.env.OSRM_URL = 'http://localhost:' + osrm.address().port;
  const { server } = require('./server');
  server.listen(0, async () => {
    const base = `http://localhost:${server.address().port}/api`;
    const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) });
    try {
      // --- public intake works without login; road data arrives asynchronously
      const r = await j('/requests', { method: 'POST', body: { type: 'water', people: 40, urgency: 4, lat: 28.55, lng: 77.15 } });
      assert.strictEqual(r.status, 201);
      let row;
      for (let i = 0; i < 30; i++) {
        row = (await (await fetch(base + '/state')).json()).requests[0];
        if (row.assignments?.[0]?.etaMin === 10) break;
        await new Promise(x => setTimeout(x, 100));
      }
      assert.strictEqual(row.assignments[0].km, 10, 'uses road km from OSRM');
      assert.strictEqual(row.assignments[0].etaMin, 10, 'has drive-time ETA');
      assert((await (await fetch(base + '/state')).json()).routing.pairs > 0);

      // --- auth
      assert.strictEqual((await j('/depots/D1', { method: 'POST', body: { stock: { water: 5 } } })).status, 401, 'edit needs login');
      assert.strictEqual((await j(`/requests/${row.id}/dispatch`, { method: 'POST' })).status, 401, 'dispatch needs login');
      assert.strictEqual((await j('/dispatch-all', { method: 'POST' })).status, 401);
      assert.strictEqual((await j('/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
      const { token } = await (await j('/login', { method: 'POST', body: { password: 'hello123' } })).json();
      assert(token && token.includes('.'));
      const auth = { Authorization: 'Bearer ' + token };
      assert.strictEqual((await j('/depots/D1', { method: 'POST', headers: auth, body: { stock: { water: 5 } } })).status, 200);
      assert.strictEqual((await j('/depots/D1', { method: 'POST', headers: { Authorization: 'Bearer ' + token.slice(0, -2) + 'xx' }, body: {} })).status, 401, 'tampered token rejected');
      assert.strictEqual((await (await j('/me', { headers: auth })).json()).loggedIn, true);
      assert.strictEqual((await (await j('/me')).json()).loggedIn, false);

      // --- SMS / WhatsApp webhook (Twilio signature enforced)
      const sms = async (params, sig) => {
        const data = 'https://example.test/api/sms' + Object.keys(params).sort().map(k => k + params[k]).join('');
        const good = crypto.createHmac('sha1', 'tok').update(data).digest('base64');
        return fetch(base + '/sms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig || good }, body: new URLSearchParams(params) });
      };
      let res = await sms({ Body: 'Need water for 40 people, children here', From: 'whatsapp:+919876543210', Latitude: '28.60', Longitude: '77.20' });
      let xml = await res.text();
      assert.strictEqual(res.status, 200);
      assert(/request #\d+ received \(water, 40 people\)/.test(xml) && /Priority: /.test(xml), xml);
      assert.strictEqual((await sms({ Body: 'Need water', Latitude: '28.6', Longitude: '77.2' }, 'forged')).status, 403, 'bad signature rejected');
      res = await sms({ Body: 'Need water for 40 people', From: '+911111111111' }); // no location, no place
      assert(/WHERE you are/.test(await res.text()), 'asks for location');
      const st = await (await fetch(base + '/state')).json();
      const smsReq = st.requests.find(x => x.channel === 'sms');
      assert.strictEqual(smsReq.contact, '***3210', 'phone number is masked');
      assert(!JSON.stringify(st).includes('9876543210'), 'full number never exposed');
      console.log('FEATURE TESTS PASSED');
    } catch (e) { console.error(e); process.exitCode = 1; }
    server.close(); osrm.close(); require('fs').rmSync(process.env.DATA_FILE, { force: true }); process.exit();
  });
});
