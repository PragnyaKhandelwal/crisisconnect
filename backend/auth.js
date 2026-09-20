// Coordinator authentication: shared password (ADMIN_KEY) -> signed, expiring bearer token. No dependencies.
const crypto = require('crypto');

const TTL = 12 * 3600e3;
const secret = () => process.env.ADMIN_KEY || '';
const enabled = () => !!secret();
const sign = p => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function issue() {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + TTL })).toString('base64url');
  return p + '.' + sign(p);
}

function valid(token) {
  if (!token || !token.includes('.')) return false;
  const [p, sig] = token.split('.');
  if (!same(sig, sign(p))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

// Token from "Authorization: Bearer ..." (or the raw key in x-admin-key for scripts).
function authorized(req) {
  if (!enabled()) return true; // no ADMIN_KEY set = open dev mode
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && valid(h.slice(7))) return true;
  return same(req.headers['x-admin-key'] || '', secret());
}

// Simple in-memory brute-force limiter: 8 failed logins / 10 min / IP.
const fails = new Map();
function limited(ip) { const f = (fails.get(ip) || []).filter(t => Date.now() - t < 600e3); fails.set(ip, f); return f.length >= 8; }
function login(ip, password) {
  if (!enabled()) return { ok: true, token: '' };
  if (limited(ip)) return { ok: false, status: 429, error: 'Too many attempts. Try again in a few minutes.' };
  if (!same(password || '', secret())) { fails.get(ip).push(Date.now()); return { ok: false, status: 401, error: 'Wrong password' }; }
  return { ok: true, token: issue() };
}

module.exports = { enabled, authorized, login };
