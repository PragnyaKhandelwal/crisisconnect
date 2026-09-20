# 🆘 CrisisConnect

Turns hundreds of chaotic emergency requests into an organized, explainable resource-allocation plan.

```
50 requests → AI triage + scoring → prioritized incidents → depot resources → optimal allocation → dispatch
```

## Run (Node 18+, zero dependencies)
```
npm start      # http://localhost:3000  (50 demo requests preloaded)
npm test       # unit + end-to-end API tests
```
Optional env: `DATABASE_URL` (Postgres), `GROQ_API_KEY=... npm start` makes free-text triage use Groq (gpt-oss-20b, free tier; falls back to rules).

## Demo script
1. Open the dashboard: map of 50 requests (red medical / orange water / yellow food / blue blankets / green depots).
2. Click any incident: see why it ranked there (score breakdown) and its supply route on the map.
3. Type "Need water - 40 people, children here", click the map, press *AI triage*: a live new incident appears (SSE).
4. *Approve full plan* dispatches the global plan, depot stock drops, unmet requests remain flagged for resupply.

## Real, live data
- Starts empty: every request and depot is entered by real users (map click, address search or GPS).
- **PostgreSQL** persistence when `DATABASE_URL` is set (tables `requests`, `depots`); local JSON file otherwise.
- Depot inventory is editable in the dashboard; the AI plan recomputes instantly.
- **AI vs first-come-first-served panel** compares strategies on the live data.

## Security: coordinator login
Set `ADMIN_KEY` (the coordinator password). Anyone can *submit* requests and view the dashboard; only a logged-in coordinator can
dispatch supplies, add depots and edit inventory. Login returns a signed 12-hour token; failed logins are rate limited.
With no `ADMIN_KEY` the app runs in open dev mode. Use a long random password in production.

## Road routing
Distances and drive-time ETAs come from OSRM (`OSRM_URL`, defaults to the public demo server) and fall back to straight-line
distance if it is unreachable. The dashboard shows which mode is active.

## SMS / WhatsApp intake (Twilio)
1. In Twilio, point your number's (or WhatsApp sandbox's) *"A message comes in"* webhook to `POST https://<your-app>/api/sms`.
2. Set `PUBLIC_URL` (your app's https URL) and `TWILIO_AUTH_TOKEN` so forged webhook calls are rejected.
3. A victim texts e.g. *"Need water for 40 people near Karol Bagh, Delhi"*. The message is triaged (Groq when configured),
   the place name is geocoded (or a WhatsApp shared location is used), a request is created, and Twilio replies with the
   request number, priority and first planned action. Phone numbers are stored masked (last 4 digits only).
Optional: `GEOCODE_COUNTRY=in` limits address lookup to a country.

## How it works
- Score (0-100) = category severity + urgency*8 + people*0.4 + distance + supply scarcity + waiting time → CRITICAL/HIGH/MEDIUM/LOW.
- Global allocator walks requests by priority, serving each from the nearest depots (splitting across depots),
  simulating stock so nothing is double-booked; volunteer teams go to far/large/medical requests.
- Water 2 L/person, food 3 meals/person, blankets 1/person, medical 1 team per 5 people.

## API
`GET /api/state` · `POST /api/requests` · `POST /api/triage {text,lat,lng}` · `POST /api/requests/:id/dispatch`
`POST /api/dispatch-all` · `POST /api/demo {count}` · `POST /api/reset` · `GET /api/stream` (SSE)

State persists to `backend/data.json`.
