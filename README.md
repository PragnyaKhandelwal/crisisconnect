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
Optional: `GROQ_API_KEY=... npm start` makes free-text triage use Groq (gpt-oss-20b, free tier; falls back to rules).

## Demo script
1. Open the dashboard: map of 50 requests (red medical / orange water / yellow food / blue blankets / green depots).
2. Click any incident: see why it ranked there (score breakdown) and its supply route on the map.
3. Type "Need water - 40 people, children here", click the map, press *AI triage*: a live new incident appears (SSE).
4. *Approve full plan* dispatches the global plan, depot stock drops, unmet requests remain flagged for resupply.

## Extra demo features
- **AI vs first-come-first-served panel**: same stock, two strategies; shows critical incidents fully served and average supply distance. Supplies are deliberately scarce in the seed scenario.
- **Simulate +1 hour**: dispatches the top plan, resupplies depots slightly, and a new wave of requests arrives.

## How it works
- Score (0-100) = category severity + urgency*8 + people*0.4 + distance + supply scarcity + waiting time → CRITICAL/HIGH/MEDIUM/LOW.
- Global allocator walks requests by priority, serving each from the nearest depots (splitting across depots),
  simulating stock so nothing is double-booked; volunteer teams go to far/large/medical requests.
- Water 2 L/person, food 3 meals/person, blankets 1/person, medical 1 team per 5 people.

## API
`GET /api/state` · `POST /api/requests` · `POST /api/triage {text,lat,lng}` · `POST /api/requests/:id/dispatch`
`POST /api/dispatch-all` · `POST /api/demo {count}` · `POST /api/reset` · `GET /api/stream` (SSE)

State persists to `backend/data.json`.
