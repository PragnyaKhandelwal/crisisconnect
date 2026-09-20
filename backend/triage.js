// Free-text -> structured request. Uses Groq when GROQ_API_KEY is set, else a rule-based parser.
const TYPES = {
  medical: /medic|doctor|injur|bleed|hospital|ambulance|insulin|pregnan|unconscious|wound|fracture|heart/i,
  water: /water|thirst|drink/i,
  food: /food|hungry|hunger|meal|ration|starv/i,
  blankets: /blanket|shelter|cold|warm|tent|clothes/i,
};

function ruleTriage(text) {
  const type = Object.keys(TYPES).find(k => TYPES[k].test(text)) || 'food';
  const m = text.match(/(\d+)\s*(people|persons|ppl|families|family|members|individuals|children|kids)?/i);
  let people = m ? parseInt(m[1], 10) : 1;
  if (m && /famil/i.test(m[2] || '')) people *= 4;
  let urgency = 3;
  if (/urgent|critical|emergency|immediately|asap|dying|life/i.test(text)) urgency = 5;
  else if (/injur|bleed|unconscious|trapped|elderly|infant|baby|pregnan|children/i.test(text)) urgency = 4;
  else if (/whenever|no rush/i.test(text)) urgency = 2;
  if (type === 'medical' && urgency < 4) urgency = 4;
  const pm = text.match(/\b(?:near|at|in|from|around)\s+([^,.;\n]+(?:,\s*[^,.;\n]+)?)\s*$/i);
  return { type, people: Math.max(1, people), urgency, place: pm ? pm[1].trim() : '', note: text.slice(0, 200), source: 'rules' };
}

async function triage(text) {
  const key = process.env.GROQ_API_KEY;
  if (key) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: 'Extract a disaster relief request from this message (any language). Reply with ONLY JSON: {"type":"water|food|blankets|medical","people":int,"urgency":1-5,"note":"short English summary","place":"place/landmark/area mentioned, or empty string"}.\n\nMessage: ' + text }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      const p = JSON.parse(j.choices[0].message.content);
      if (TYPES[p.type] && p.people > 0) return { type: p.type, people: p.people | 0, urgency: Math.min(5, Math.max(1, p.urgency | 0 || 3)), note: String(p.note || text).slice(0, 200), place: String(p.place || '').slice(0, 120), source: 'groq' };
    } catch { /* fall through to rules */ }
  }
  return ruleTriage(text);
}

module.exports = { triage, ruleTriage };
