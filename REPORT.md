# CrisisConnect: Project Report

**AI-powered disaster-relief coordination: from chaotic requests to an explainable allocation plan**

- Live app: https://crisisconnect-hf37.onrender.com
- Source code: https://github.com/PragnyaKhandelwal/crisisconnect
- Category: hackathon project, full stack, deployed and live end to end

---

## 1. Executive summary

During disasters the biggest problem is often **not a lack of resources but poor allocation**. Requests arrive by
phone, message and word of mouth, in different languages, with no ranking. Coordinators triage by hand, supplies go to
whoever asked first or loudest, and critical cases can wait while easy ones are served.

CrisisConnect takes emergency requests from several channels (web form, free-text AI intake in any language,
SMS/WhatsApp), scores every request by urgency, people affected, distance, supply scarcity and waiting time, and
produces a plan that assigns real depot stock and volunteer teams to the most urgent incidents first, using real
road distances and drive-time ETAs. A coordinator reviews the plan, approves it, and the system deducts stock and
records everything in a database. Every priority is explainable: click an incident and see exactly why it ranked
where it did.

**One-line pitch:** *"Turn hundreds of chaotic emergency requests into an organized, explainable resource-allocation plan, live."*

## 2. The problem

| Pain point | What happens today |
|---|---|
| Requests arrive unstructured | Free-text messages, calls, forms; mixed languages; no standard fields |
| No consistent prioritization | First-come-first-served or gut feeling; critical cases can be starved |
| Resources are scattered | Stock sits in several depots; nobody has a live picture of what is where |
| Distance is ignored or guessed | Teams drive farther than needed; ETAs are unknown |
| No accountability | It is unclear why one request was served before another |

## 3. The solution

```
Requests (web form / free-text AI / SMS / WhatsApp)
      -> AI triage (type, people, urgency, place)
      -> Priority score + explanation (0-100, CRITICAL/HIGH/MEDIUM/LOW)
      -> Live depot inventory
      -> Road-distance allocation plan (split across depots, volunteer teams, shortfalls flagged)
      -> Coordinator approves -> stock deducted -> saved to PostgreSQL
      -> Live dashboard updates for everyone
```

### Example (illustrative, based on the original brief)
```
REQUEST #184
40 people, no drinking water, 8.7 km from nearest supply
Priority: CRITICAL
Suggested allocation:
  -> Allocate 80 L from Central Relief Depot (8.7 km, ~12 min)
  -> Dispatch volunteer team
```

## 4. Features (what was built and verified)

1. **Multi-channel intake**
   - Web form (type, people, urgency, note, location).
   - **AI free-text triage** via Groq (`openai/gpt-oss-20b`): "पानी चाहिए, 60 लोग, बच्चे भी हैं" becomes water, 60 people, urgency, place. Works in Hindi and other languages. Rule-based fallback if the AI is unavailable.
   - **SMS / WhatsApp** through a Twilio webhook. Victims text a need plus a place (or share WhatsApp location); the system creates the request and replies with the request number, priority and first action.
2. **Location input**: click the map, search an address (OpenStreetMap Nominatim), or use device GPS.
3. **Explainable prioritization**: score breakdown per incident (severity, urgency, people, distance, scarcity, waiting time).
4. **Global allocation engine**: priority order, nearest depots first, splits a request across depots, simulates stock so nothing is double-booked, flags shortfalls for resupply, assigns volunteer teams.
5. **Real road routing**: OSRM road distance and drive-time ETA; automatic straight-line fallback; dashboard shows which mode is active.
6. **AI vs first-come-first-served panel**: same stock, two strategies, side by side on live data.
7. **Live inventory management**: depots and stock are entered and edited in the dashboard; the plan recomputes instantly.
8. **Coordinator login**: everyone can submit and view; only coordinators can dispatch, add depots and edit stock. Signed 12-hour tokens, login rate limiting.
9. **Real-time dashboard**: Server-Sent Events push changes to every open screen; map with color-coded incidents and depots; supply routes drawn for a selected incident; filters (Critical / High / Unmet / Done).
10. **Durable storage**: PostgreSQL (Neon). The API answers only after the write is committed.
11. **Works on phones**: responsive layout verified at 320 px, 390 px, 820 px and 1440 px widths.

### Map legend (as in the brief)
Red = medical emergency, orange = water shortage, yellow = food shortage, blue = blankets/shelter, green = resources available (depots).

## 5. How the AI prioritization works

### 5.1 Priority score (0 to 100, capped)
```
score = severity + urgency + people + distance + scarcity + waiting
```
| Factor | Formula | Meaning |
|---|---|---|
| Severity | category base x 3 (medical 10, water 7, food 5, blankets 3) | How life-critical the need is |
| Urgency | reporter urgency (1-5) x 8 | Reported / AI-inferred urgency |
| People | min(people, 100) x 0.4 | Scale of impact |
| Distance | min(road km to nearest stocked depot, 30) x 0.6 | Harder-to-reach cases escalate |
| Scarcity | up to 10 points when total stock is small compared with demand | Scarce supply raises priority |
| Waiting | hours waiting, capped at 12 | Prevents starvation of old requests |

Tiers: **CRITICAL >= 75, HIGH >= 60, MEDIUM >= 45, LOW below 45.**

### 5.2 Demand estimation
Water 2 L per person, food 3 meals per person, blankets 1 per person, medical 1 team per 5 people (rounded up).

### 5.3 Allocation algorithm
1. Score all open requests and sort by score (highest first).
2. For each request, sort depots by road distance.
3. Take stock from the nearest depot, then the next, until the need is met or stock runs out (splitting across depots).
4. Deduct from a *simulated* stock copy so no two requests can claim the same units.
5. Assign a volunteer team when the request is medical, far (over 5 km), or large (30+ people).
6. Mark each request covered, partial or unmet; unmet and shortfalls become resupply alerts.
7. On coordinator approval, apply the plan to real stock in one transaction and record it.

### 5.4 Why it beats first-come-first-served
FCFS serves in arrival order, so scarce stock can go to low-priority early requests. The panel runs both strategies on the same data. In our scarce-supply test scenario (40 simulated requests, limited stock) the AI plan fully served **8 of 8 critical incidents versus 6 of 8** for FCFS, at the cost of about 2 km more average travel (13.1 km versus 15.3 km), a deliberate trade-off. When supplies are plentiful both strategies perform the same, which is expected.

## 6. Architecture and tech stack

```
Browser (Leaflet map, vanilla JS)  <--HTTPS + SSE-->  Node.js server (no framework)
                                                        |-- prioritizer.js  scoring + allocation + comparison
                                                        |-- triage.js       Groq LLM + rule-based fallback
                                                        |-- roads.js        OSRM distances / ETAs (cached, fallback)
                                                        |-- sms.js          Twilio webhook, geocoding, signature check
                                                        |-- auth.js         coordinator tokens, rate limiting
                                                        |-- data.js         PostgreSQL persistence
Twilio (SMS / WhatsApp) --webhook--> /api/sms
PostgreSQL (Neon)  <-- write-through, loaded on boot
```

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, Leaflet, OpenStreetMap tiles |
| Backend | Node.js 22, built-in `http` module, Server-Sent Events (only runtime dependency: `pg`) |
| Database | PostgreSQL on Neon (tables `requests`, `depots`, JSONB payloads) |
| AI | Groq API, `openai/gpt-oss-20b` (triage and multilingual extraction) |
| Routing / geocoding | OSRM (road distance and ETA), OpenStreetMap Nominatim |
| Messaging | Twilio SMS / WhatsApp webhook |
| Hosting / CI | Render (Docker, auto-deploy from GitHub) |

## 7. API summary
- Public: `GET /api/state`, `GET /api/me`, `POST /api/requests`, `POST /api/triage`, `POST /api/sms` (Twilio), `POST /api/login`, `GET /api/stream` (SSE)
- Coordinator only: `POST /api/requests/:id/dispatch`, `POST /api/dispatch-all`, `POST /api/depots`, `POST /api/depots/:id`, `POST /api/admin/clear`

## 8. Security and reliability
- Coordinator-only actions require a signed, expiring token (HMAC-SHA256); tampered tokens are rejected; failed logins are rate limited (8 per 10 minutes per IP); comparisons are timing-safe.
- Twilio webhook requests are verified with the Twilio signature (HMAC-SHA1) when configured; forged calls get 403.
- Phone numbers are stored masked (last 4 digits) and never exposed by the public API.
- Input validation on all write endpoints; request size limits; output escaping in the UI (XSS-safe).
- Demo/reset endpoints are disabled in production.
- Secrets live in environment variables, not in the repository.
- **Durability:** writes are batched into one transaction and the API responds only after commit; graceful shutdown flushes pending writes. Verified by hard-killing the server right after responses and confirming all data survived a restart.
- Graceful degradation: road routing falls back to straight-line distance, AI triage falls back to rules.

## 9. Testing and verification
| Level | What was verified |
|---|---|
| Unit | Scoring order (medical outranks water), allocation never over-commits stock, triage parsing |
| API end to end | Request lifecycle, validation errors (400), dispatch conflicts (409), stock deduction |
| Feature tests | Auth (401 without token, tampered token rejected), road routing against a mock OSRM server, SMS webhook with signature check and phone masking |
| Database | Direct queries against Neon confirmed the same rows the app shows; hard-kill persistence test |
| Live site | Login, AI triage (including Hindi), road ETAs, dispatch, duplicate-dispatch rejection, unsigned-webhook rejection (403) |
| Real-browser UI (Edge automation) | Load, map tiles, card selection with route line, filters, login, map-click intake, free-text and manual submission, dispatch, depot edit, add depot, approve full plan, logout, responsive layouts at 4 widths, no console errors |
| WhatsApp | Sandbox joined and webhook configured on real WhatsApp |

## 10. Engineering challenges and how they were solved (good for a "what we learned" slide)
1. **Data lost on restart**: the free host's disk is ephemeral, so requests vanished. Moved to PostgreSQL with write-through persistence.
2. **Write acknowledged before it was stored**: a hard-kill test lost data. Fixed by responding only after commit, batching writes, and flushing on shutdown.
3. **Live updates behind a proxy**: the event stream could be buffered, so the UI showed nothing after submit. The UI now re-fetches after every action, the stream sends heartbeats, and polling is a fallback.
4. **A toast message covered the Submit button**, swallowing clicks. Found through automated browser testing; fixed.
5. **Mobile overflow** from a five-column inventory row. Found through width testing; fixed.
6. **"Everything is fake" problem**: seeded demo data was removed; the app starts empty and all data is real user input.
7. **Making the comparison honest**: with plentiful stock both strategies tie, so scarce-supply scenarios were used, and the panel reports the real trade-off (more distance) rather than hiding it.

## 11. Honest limitations
- Allocation is a priority-ordered greedy algorithm, not a proven global optimum (a min-cost-flow / assignment solver is the natural next step).
- One server instance keeps state in memory and writes through to the database; scaling out would need shared state.
- Coordinator auth is a single shared password (no per-user accounts or audit trail).
- Public OSRM and Nominatim servers are for light use; production needs self-hosting or caching.
- Free hosting sleeps after about 15 minutes idle (first load takes up to a minute).
- Twilio sandbox limits: sandbox membership expires and must be re-joined; production needs an approved sender.
- Demand rules (2 L water per person etc.) are simple defaults, not agency-calibrated standards.

## 12. Future scope

The current version proves the core loop (intake, prioritization, allocation, dispatch) end to end. The roadmap below
shows how it grows from a hackathon prototype into a production disaster-response platform.

### Phase 1: Near term (next 1-3 months): make the core stronger
| Item | What it adds | Why it matters |
|---|---|---|
| **Optimal allocation solver** | Replace the greedy allocator with min-cost-flow / assignment optimization and multi-objective tuning (lives served, travel time, fairness) | Moves from "good and explainable" to provably better plans |
| **Per-user accounts, roles and audit log** | Coordinator, volunteer, depot manager and viewer roles; every dispatch recorded with who and when | Accountability and safe multi-team operation |
| **Duplicate and fraud detection** | Merge repeated requests from the same area, flag suspicious or spam messages, coordinator verification step | Keeps the queue trustworthy under message floods |
| **Volunteer mobile flow** | Task assignment, accept / decline, status (assigned, en route, delivered), proof of delivery | Closes the loop from plan to actual delivery |
| **Delivery tracking and notifications** | Live status updates and SMS/WhatsApp confirmations back to the requester | Victims know help is coming |
| **Self-hosted routing and geocoding** | Own OSRM and geocoder instances with caching | Reliability and no dependence on public demo servers |

### Phase 2: Mid term (3-9 months): smarter and more accessible
| Item | What it adds | Why it matters |
|---|---|---|
| **Offline-first PWA** | Installable app with offline queue and sync for low-connectivity zones | Disasters often knock out networks |
| **Voice and image intake** | Voice notes with speech-to-text, photo of damage or injuries analysed by a vision model | Reaches people who cannot type; richer triage evidence |
| **More channels and languages** | Telegram, Facebook Messenger, IVR phone line, wider regional-language support | Meets people where they already are |
| **Demand forecasting** | Predict needs by area and time (for example water demand after a flood) from history and weather | Pre-position supplies before requests arrive |
| **Hotspot and cluster analysis** | Heat maps, neighbourhood-level aggregation, "one truck serves five requests" route batching | Efficient use of vehicles and volunteers |
| **Route optimization for fleets** | Multi-stop delivery routes (vehicle routing problem), road closures and flood-zone avoidance | Fewer trips, faster coverage |
| **Feedback learning** | Learn scoring weights from coordinator overrides and post-event outcomes | The model improves with every disaster |

### Phase 3: Long term (9-18 months): a platform for authorities and NGOs
| Item | What it adds | Why it matters |
|---|---|---|
| **Government and NGO integration** | Connect to disaster-management data feeds, national alert systems and NGO inventory systems | One shared operating picture across agencies |
| **Multi-region, multi-agency deployment** | Tenant separation, regional depots, hand-off between districts, high availability across instances | Scales from a district to a state or country |
| **Resupply and procurement automation** | Auto-generate purchase lists and transfer orders when stock runs short; supplier and donor matching | Turns shortage alerts into action |
| **Donor and volunteer marketplace** | Public portal for verified donations, skills-matched volunteers, transparent tracking | Channels public goodwill efficiently |
| **Impact analytics and reporting** | Response-time, coverage and equity dashboards; automatic after-action reports | Evidence for funding and policy |
| **Human-in-the-loop AI governance** | Bias and fairness audits, explanation logs, configurable policies per agency | Responsible, trusted use of AI in emergencies |
| **Extended domains** | Pandemic response, refugee camps, food banks and everyday community aid | The same engine, wider social impact |

### Why this scope is realistic
The system is already modular (separate scoring, routing, triage, messaging, auth and storage modules), so each item above
plugs into an existing boundary. Examples: a new intake channel is a new webhook next to `/api/sms`; a better solver
replaces one function in the allocator; per-user auth replaces one module; the volunteer flow is a new view on the same
database.

## 13. Impact and value
- **Faster triage**: seconds instead of manual sorting; critical cases surface first.
- **Fairer, explainable decisions**: every ranking is justified, which builds trust and supports accountability.
- **Less waste and shorter trips**: nearest-stock allocation with real road ETAs.
- **Inclusive access**: multilingual free-text and plain SMS/WhatsApp mean victims need no app or internet-heavy form.
- **Lightweight to adopt**: runs on a free tier with a single Docker service and a free database.

---

## 14. Suggested slide deck (about 16 slides, 8-10 minutes)

| # | Slide | Content | Suggested visual |
|---|---|---|---|
| 1 | Title | CrisisConnect: turning chaos into an allocation plan. Team, live URL | Logo + dashboard screenshot |
| 2 | The problem | "The bottleneck is allocation, not just supply." Unstructured requests, no priority, scattered stock | Chaotic messages graphic |
| 3 | The idea | One-line pitch and the pipeline (requests, AI, priorities, resources, allocation) | Pipeline diagram (section 3) |
| 4 | Demo example | Request #184: 40 people, no water, 8.7 km, CRITICAL, allocate 80 L and dispatch volunteers | Incident card screenshot |
| 5 | Multi-channel intake | Web form, AI free-text (Hindi example), WhatsApp/SMS, map/GPS/address | Phone WhatsApp screenshot + form |
| 6 | Explainable AI scoring | The six factors, tiers, and the score-breakdown bars | Formula table + breakdown UI |
| 7 | Allocation engine | Priority order, nearest depots, splitting, no double-booking, shortfall flags, volunteers | Flow diagram (section 5.3) |
| 8 | Real road routing | OSRM distance and ETA, e.g. "8.7 km, ~12 min", fallback design | Map with dashed supply route |
| 9 | AI vs first-come-first-served | 8/8 vs 6/8 critical served, +2 km trade-off, honest comparison | Comparison panel screenshot |
| 10 | Live coordinator dashboard | Real-time map, inventory editing, approve and dispatch, login | Full dashboard screenshot |
| 11 | Architecture and stack | Diagram and tech table (section 6) | Architecture diagram |
| 12 | Security and reliability | Signed tokens, webhook signatures, masked numbers, durable writes, graceful fallbacks | Icon list |
| 13 | Testing and lessons | Test levels, real-browser testing, three bugs found and fixed, durability test | Checklist |
| 14 | Limitations | Honest limits: greedy (not proven optimal) allocator, single shared password, public routing servers, free-tier sleep | Short bullet list |
| 15 | Future scope | Three phases: near term (optimal solver, per-user roles and audit, volunteer app, duplicate detection), mid term (offline PWA, voice and image intake, forecasting, fleet routing), long term (government/NGO integration, multi-region scale, procurement automation, impact analytics) | Three-phase roadmap timeline |
| 16 | Closing / call to action | Live URL, repo, impact statement, "from chaos to coordinated relief" | QR code to live app |

## 15. Live demo script (3-4 minutes)
1. **Open the dashboard** (wake the free server beforehand): map, pipeline strip, stats.
2. **Show the problem**: with many requests loaded, point out the ranked list and the comparison panel (AI vs FCFS).
3. **Click a CRITICAL incident**: show the score breakdown and the dashed supply route with road ETA.
4. **Submit a live request from a phone**: WhatsApp *"Need water for 40 people near Karol Bagh, Delhi"* and show the reply and the new incident appearing on screen.
5. **Free-text in Hindi** from the web form to show multilingual triage.
6. **Coordinator login**: show that dispatch and inventory controls appear only after login; edit a depot's stock and watch the plan change.
7. **Approve and dispatch**: stock decreases; unmet requests remain flagged for resupply.
8. **Close** with architecture, limitations and the future-scope roadmap.

Prep checklist: open the site 1-2 minutes before starting (free-tier wake-up), have the WhatsApp chat ready, seed a scarce-supply scenario so the comparison shows a gap, know the coordinator password, keep a screenshot backup in the deck.

## 16. Anticipated judge questions
| Question | Answer |
|---|---|
| Is this real or a mock? | Real: live database, real routing service, real LLM triage, real WhatsApp webhook. The app starts empty; a synthetic data generator exists only for local testing and is disabled in production. |
| How is the priority calculated, is it a black box? | No: a transparent weighted formula with a per-incident breakdown; the LLM is used only to understand messages, not to decide priorities. |
| Is it optimal? | It is a priority-ordered greedy allocator, which is fast and explainable. A min-cost-flow solver is the next step; we do not claim provable optimality. |
| What if the AI or routing service fails? | Automatic fallbacks: rule-based parsing and straight-line distance. |
| What about wrong or malicious requests? | Input validation, rate limiting, masked contacts, coordinator approval before any dispatch. A verification/duplicate-detection layer is on the roadmap. |
| Privacy? | Phone numbers stored masked; secrets in environment variables; no personal data exposed by the public API. |
| Can it scale? | Stateless design plus a managed database; needs shared state or a queue for multiple instances (documented). |
| Why not just a spreadsheet? | Spreadsheets do not rank, allocate against live stock, compute road ETAs, or take requests by WhatsApp. |
| How did you validate it? | Unit, API, feature and real-browser tests, direct database checks, a hard-kill durability test, and live-site verification. |

## 17. Project facts for slides
- Build type: full stack, single Docker service, deployed and live
- Runtime dependency footprint: one npm package (`pg`); the server uses no web framework
- Channels: web form, AI free-text, SMS, WhatsApp
- Languages handled by AI intake: any language the model supports, tested with Hindi
- Response: request to ranked, allocated plan in seconds, updated live for all viewers
- Tested viewports: 320, 390, 820, 1440 px
