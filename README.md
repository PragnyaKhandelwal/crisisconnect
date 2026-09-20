# 🆘 CrisisConnect

**Turn hundreds of chaotic emergency requests into an organized, explainable resource-allocation plan.**

Live app: https://crisisconnect-hf37.onrender.com &nbsp;·&nbsp; Repo: https://github.com/PragnyaKhandelwal/crisisconnect

During a disaster the problem is often not a lack of resources but poor allocation. CrisisConnect collects requests
(web form, free text in any language, SMS/WhatsApp), scores each one, and computes a plan that assigns real depot
stock and volunteer teams to the most urgent incidents first, using real road distances.

```
requests (web / free-text AI / SMS / WhatsApp)
        -> AI triage (Groq) -> priority score + explanation
        -> ranked incidents -> depot inventory (live) -> road-distance allocation
        -> coordinator approves -> stock deducted -> everything saved in PostgreSQL
```

## 🧑‍⚖️ For judges: try it in 3 minutes

**Live app:** https://crisisconnect-hf37.onrender.com
*(Hosted on a free tier: if it has been idle, the first load can take up to a minute. Please wait and refresh once.)*

| # | What to try | How | Needs setup? |
|---|---|---|---|
| 1 | **See the AI prioritize and allocate** | Open the link. Requests appear ranked with CRITICAL / HIGH / MEDIUM / LOW. Click any incident to see *why* it ranked there (score breakdown) and its road route and ETA on the map. The **AI vs first-come-first-served** panel compares strategies. | No |
| 2 | **Send a request like a victim would (in-browser simulator)** | Scroll to **💬 Try the WhatsApp / SMS flow**. Type *"Need water for 40 people near Karol Bagh, Delhi"* (English, Hindi and other languages work). To share a location the way WhatsApp does, click the map first. The bot replies with the request number, priority and first planned action, and the new incident appears on the map. | **No. Recommended.** |
| 3 | **Real WhatsApp** | Join our Twilio sandbox once: tap https://wa.me/17372508034?text=join%20twilio-trial (or WhatsApp **join twilio-trial** to **+1 (737) 250-8034**), then send the same kind of message. Replies and new incidents arrive live. | Quick, one-time join |
| 4 | **Coordinator actions** | Click **Coordinator login** (top right) and enter the password from the submission notes. Then you can approve and dispatch requests, edit depot stock, add depots, and press **Approve full plan**. Without login the dashboard is view and submit only. | Password |

**About the real messaging option.** WhatsApp works for anyone who joins the sandbox with the code above (no need for us to add you).
The Twilio *trial* sandbox membership expires after about 72 hours and re-joining is a single message. Plain **SMS** on a Twilio trial can only
reach numbers verified in the console, so it cannot be opened to the public; the in-browser simulator (row 2) runs the *exact same code path* as the
real webhook (triage, geocoding, request creation, priority, reply), so you can evaluate the SMS/WhatsApp flow without any setup.
<!-- add demo video link here -->

## Features
| Area | What it does |
|---|---|
| **Prioritization** | Score 0-100 from severity, urgency, people affected, distance, supply scarcity and waiting time (CRITICAL / HIGH / MEDIUM / LOW). Click an incident to see the score breakdown. |
| **Allocation** | Walks incidents by priority, serves each from the nearest depots (splitting across depots), simulates stock so nothing is double-booked, flags shortfalls for resupply, assigns volunteer teams. |
| **AI vs first-come-first-served** | Panel comparing both strategies on the same live data (critical incidents fully served, average distance). |
| **AI triage** | Free text ("Need water for 40 people, children here", or Hindi/other languages) becomes type, people, urgency and place via Groq (`openai/gpt-oss-20b`). Falls back to a rule-based parser if no key or on error. |
| **Road routing** | Real road distance and drive-time ETA from OSRM; automatic straight-line fallback. Dashboard shows which mode is active. |
| **Messaging simulator** | In-browser chat that runs the same pipeline as the Twilio webhook, so anyone can try the SMS/WhatsApp flow with no setup. |
| **SMS / WhatsApp intake** | Twilio webhook `POST /api/sms`. Victims text a need plus a place name (or share WhatsApp location); the app creates the request and replies with its number, priority and first action. Numbers stored masked. |
| **Location input** | Click the map, search an address (OpenStreetMap Nominatim) or use device GPS. |
| **Inventory** | Depots and stock are entered and edited in the dashboard (coordinators). The plan recomputes instantly. |
| **Coordinator login** | Anyone can submit requests and view; only coordinators can dispatch, add depots and edit stock. Signed 12-hour tokens, rate-limited login. |
| **Live + durable** | Server-Sent Events push updates to every open dashboard; PostgreSQL persistence (API answers only after the write is committed). |

## Run locally (Node 18+)
```
npm install
npm start          # http://localhost:3000  (JSON-file storage, open dev mode)
npm test           # unit + end-to-end API tests (auth, road routing mock, SMS webhook)
```
The app starts **empty**. Add depots and requests in the UI, or via the API.

## Configuration (environment variables)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. Neon). Without it, data goes to `backend/data.json` (lost on ephemeral hosts). Tables are created automatically. |
| `ADMIN_KEY` | Coordinator password. Unset = open dev mode. Use a long random value in production. |
| `GROQ_API_KEY` | Enables LLM triage (`GROQ_MODEL` to change the model). |
| `OSRM_URL` | Routing server (default: public OSRM demo server; use your own for heavy traffic). |
| `PUBLIC_URL`, `TWILIO_AUTH_TOKEN` | Enable Twilio signature verification for `/api/sms`. Set both in production. |
| `GEOCODE_COUNTRY` | e.g. `in` to limit SMS address lookup to one country. |
| `PORT` | Server port (default 3000). |

## Deploy (Render, free tier)
`Dockerfile` and `render.yaml` are included: New -> Blueprint -> pick the repo -> set the environment variables above.
Free instances sleep after ~15 min idle (first load can take ~30-60 s); open the site before a demo, or ping it with an uptime monitor.

## SMS / WhatsApp setup (Twilio)
1. Twilio Console -> Messaging -> WhatsApp sandbox (free) or a phone number.
2. Set the incoming-message webhook to `POST https://<your-app>/api/sms`.
3. Set `PUBLIC_URL` (your https URL, no trailing slash) and `TWILIO_AUTH_TOKEN` on the server.
4. Text: *"Need water for 40 people near Karol Bagh, Delhi"*.

Without Twilio you can still exercise the webhook:
`curl -X POST https://<your-app>/api/sms -d "Body=Need water for 40 people&Latitude=28.6&Longitude=77.2"` (works when `TWILIO_AUTH_TOKEN` is unset).

## API
Public: `POST /api/sms-demo {text,lat?,lng?}` (simulator) · `GET /api/state` · `GET /api/me` · `POST /api/requests` · `POST /api/triage {text,lat,lng}` · `POST /api/sms` (Twilio) · `POST /api/login {password}` · `GET /api/stream` (SSE)
Coordinator (Bearer token or `x-admin-key`): `POST /api/requests/:id/dispatch` · `POST /api/dispatch-all` · `POST /api/depots` · `POST /api/depots/:id` · `POST /api/admin/clear`

## Architecture
```
frontend/  static dashboard (Leaflet map, vanilla JS)
backend/server.js       HTTP API + SSE + static files (no framework)
backend/prioritizer.js  scoring + global allocation + strategy comparison
backend/triage.js       Groq LLM triage with rule-based fallback
backend/roads.js        OSRM road distances / ETAs with fallback
backend/sms.js          Twilio webhook, geocoding, signature check
backend/auth.js         coordinator tokens + login rate limit
backend/data.js         PostgreSQL / JSON persistence
```

## Known limitations
- Allocation is a priority-ordered greedy algorithm, not a proven global optimum (a min-cost-flow solver would be the next step).
- One server instance holds state in memory and writes through to PostgreSQL; scaling to several instances would need shared state.
- Coordinator auth is a single shared password (no per-user accounts or audit log).
- The public OSRM and Nominatim servers are for light use; self-host or add caching for real traffic.
