# space-pay

One file payment server for the game. Pine Labs Online (Plural) Hosted Checkout,
with a MOCK mode so the game works before the sandbox keys arrive.

Everything lives in `pay.js`.

## Run

```bash
npm install
cp .env.example .env     # optional, MOCK mode needs no env at all
node pay.js
```

Starts on `http://localhost:8787`. With no `PINELABS_CLIENT_ID` set it prints
`MOCK mode`, which means `/api/buy` grants the item immediately and never talks
to Pine Labs.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/buy` | `{ playerId, item }` -> mock grant, or a hosted checkout url |
| POST/GET | `/api/callback` | Pine Labs sends the browser here, redirects on to `FRONTEND_URL?paid=1\|0` |
| POST | `/api/webhook` | Signed server to server event, the source of truth for granting |
| GET | `/api/order/:id` | Order status (in memory for mock, Get Order API for real) |
| GET | `/api/inventory/:playerId` | What the player owns so far |
| GET | `/health` | `{ ok: true, mode }` |

Items and prices are in `PRICES` in `pay.js`. Amounts are in **paise** (the
smallest currency unit), so `oxygen: 900` is Rs 9.00.

## Test MOCK mode with curl

```bash
# health
curl http://localhost:8787/health

# buy
curl -s -X POST http://localhost:8787/api/buy \
  -H "Content-Type: application/json" \
  -d '{"playerId":"p1","item":"oxygen"}'
# -> {"status":"PAID","orderId":"mock-1761300000000-ab12cd","checkoutUrl":null}

# status of that order
curl -s http://localhost:8787/api/order/mock-1761300000000-ab12cd

# what p1 owns
curl -s http://localhost:8787/api/inventory/p1

# unknown item is rejected
curl -s -X POST http://localhost:8787/api/buy \
  -H "Content-Type: application/json" \
  -d '{"playerId":"p1","item":"rocket"}'
```

In PowerShell use `curl.exe` and escape the quotes, or just use
`Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/buy -ContentType application/json -Body '{"playerId":"p1","item":"oxygen"}'`.

A fake webhook also works in mock mode (signature checking is skipped only when
there is no `PINELABS_WEBHOOK_SECRET` **and** we are in mock mode):

```bash
curl -s -X POST http://localhost:8787/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"event_type":"ORDER_PROCESSED","data":{"merchant_order_reference":"mock-...","order_id":"v1-test","status":"PROCESSED"}}'
```

## When the real keys arrive

Set these and restart. The presence of `PINELABS_CLIENT_ID` is what flips the
server into REAL mode.

| Env var | Value |
| --- | --- |
| `PINELABS_CLIENT_ID` | client id from the Pine Labs dashboard |
| `PINELABS_CLIENT_SECRET` | client secret, server side only |
| `PINELABS_WEBHOOK_SECRET` | webhook secret key from dashboard Settings, base64 |
| `PINELABS_BASE_URL` | `https://pluraluat.v2.pinepg.in` for UAT, `https://api.pluralonline.com` for prod |
| `PUBLIC_URL` | public url of this server, used to build the callback urls |
| `FRONTEND_URL` | the game origin, the only allowed CORS origin and the post payment redirect target |
| `PORT` | Render sets this automatically |

Then on the Pine Labs side:

1. Ask support to register `{PUBLIC_URL}/api/webhook` as the webhook url. Webhooks
   are configured during onboarding, not self serve.
2. Whitelist the Pine Labs webhook source IPs if anything sits in front of this
   server.
3. Grab the webhook secret key from the dashboard under Settings.

Real mode flow:

1. `POST /api/buy` gets a token from `POST {BASE}/api/auth/v1/token`
   (`client_credentials`, cached until `expires_at` minus 60s).
2. It calls `POST {BASE}/api/checkout/v1/orders` with
   `merchant_order_reference`, `order_amount: {value, currency}`,
   `integration_mode: "REDIRECT"`, `callback_url` and `failure_callback_url`,
   and returns `{ orderId, checkoutUrl }` where `checkoutUrl` is the
   `redirect_url` from the response.
3. The frontend sends the player to `checkoutUrl`.
4. Pine Labs returns the browser to `/api/callback`. That redirect is **not**
   signed, the docs say it is for customer experience only, so the server
   re-reads the real status with `GET {BASE}/api/pay/v1/orders/{order_id}`
   before deciding `paid=1` or `paid=0`.
5. `POST /api/webhook` is the authoritative grant. Signature is verified as
   HMAC-SHA256 over `webhook-id.webhook-timestamp.rawBody` using the base64
   decoded secret, compared against the `v1,` prefixed `webhook-signature`
   header in constant time. `ORDER_PROCESSED` and `ORDER_AUTHORIZED` grant the
   item.

`grantItem` is idempotent, because the callback and the webhook can both fire
and Pine Labs retries webhooks up to three times.

## Deploy on Render

- Build command: `npm install`
- Start command: `node pay.js`
- `PORT` is injected by Render, the rest of the vars above go in the dashboard.
  Keep `PINELABS_CLIENT_SECRET` and `PINELABS_WEBHOOK_SECRET` out of the repo
  and out of anything the frontend can read.

## TODO

`grantItem()` in `pay.js` currently logs and writes to an in-memory map. There
is a marked `TODO(spacetimedb)` where the SpacetimeDB reducer call goes. In
memory state is lost on restart, which is fine for the hackathon but not for
anything real.
