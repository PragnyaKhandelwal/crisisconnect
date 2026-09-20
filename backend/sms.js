// SMS / WhatsApp intake via a Twilio webhook (POST /api/sms, form-encoded).
// Location comes from a WhatsApp shared location (Latitude/Longitude) or a place name in the text (geocoded).
const crypto = require('crypto');

const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const twiml = msg => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(msg)}</Message></Response>`;

async function geocode(place) {
  if (!place) return null;
  const cc = process.env.GEOCODE_COUNTRY ? `&countrycodes=${encodeURIComponent(process.env.GEOCODE_COUNTRY)}` : '';
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1${cc}&q=${encodeURIComponent(place)}`, {
      headers: { 'User-Agent': 'CrisisConnect/1.0 (disaster relief coordination)' }, signal: AbortSignal.timeout(6000),
    })).json();
    return r.length ? { lat: +r[0].lat, lng: +r[0].lon } : null;
  } catch { return null; }
}

// Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted "key+value" pairs)).
function signatureOk(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // not configured: accept (set TWILIO_AUTH_TOKEN in production to block spoofed calls)
  const base = (process.env.PUBLIC_URL || '') + '/api/sms';
  const data = base + Object.keys(params).sort().map(k => k + params[k]).join('');
  const want = crypto.createHmac('sha1', token).update(data).digest('base64');
  const got = String(req.headers['x-twilio-signature'] || '');
  return want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

async function handle(params, deps) {
  const body = String(params.Body || '').trim();
  if (!body && !params.Latitude) return twiml('CrisisConnect: describe what you need, e.g. "Need water for 40 people near Karol Bagh".');
  const t = await deps.triage(body || 'help needed');
  let loc = params.Latitude && params.Longitude ? { lat: +params.Latitude, lng: +params.Longitude } : null;
  if (!loc) loc = await geocode(t.place);
  if (!loc || isNaN(loc.lat) || isNaN(loc.lng)) {
    return twiml('We understood your need but not WHERE you are. Reply with your area/landmark (e.g. "Need water for 40 people near Karol Bagh, Delhi") or share your WhatsApp location.');
  }
  const from = String(params.From || '').replace(/\D/g, '');
  const r = await deps.create({ type: t.type, people: t.people, urgency: t.urgency, lat: loc.lat, lng: loc.lng, note: t.note, channel: 'sms', contact: from ? '***' + from.slice(-4) : '' });
  const first = r.plan && r.plan[0] ? r.plan[0] : 'Coordinators have been alerted';
  return twiml(`CrisisConnect: request #${r.id} received (${t.type}, ${t.people} people). Priority: ${r.priority}. ${first}. Stay safe.`);
}

module.exports = { handle, signatureOk, twiml, geocode };
