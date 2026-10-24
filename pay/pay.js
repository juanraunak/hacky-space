// space-pay: tiny payment server for the hackathon game.
// Pine Labs Online (Plural) Hosted Checkout, with a MOCK mode so the game
// works before sandbox keys arrive.
//
// Docs used:
//   Generate Token        POST {BASE}/api/auth/v1/token
//   Generate Checkout     POST {BASE}/api/checkout/v1/orders   (integration_mode REDIRECT)
//   Get Order by ID       GET  {BASE}/api/pay/v1/orders/{order_id}
//   Webhook signature     HMAC-SHA256 over "webhook-id.webhook-timestamp.body"
//
// MOCK mode is on whenever PINELABS_CLIENT_ID is not set.

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const PORT = Number(process.env.PORT) || 8787;
const BASE = (process.env.PINELABS_BASE_URL || "https://pluraluat.v2.pinepg.in").replace(/\/+$/, "");
const CLIENT_ID = process.env.PINELABS_CLIENT_ID;
const CLIENT_SECRET = process.env.PINELABS_CLIENT_SECRET;
const WEBHOOK_SECRET = process.env.PINELABS_WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
// Public URL of THIS server, used to build callback urls Pine Labs can reach.
// On Render set this to the service url, e.g. https://space-pay.onrender.com
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

const MOCK = !CLIENT_ID;

// Item price table. Pine Labs amounts are in the smallest currency unit,
// so for INR the value is paise. 900 paise = Rs 9.00.
const PRICES = { oxygen: 900 };
const CURRENCY = "INR";

// Order statuses that mean "money is ours, grant the item".
// From the Get Order API status list: CREATED, PENDING, PROCESSED, AUTHORIZED,
// CANCELLED, ATTEMPTED, FAILED, FULLY_REFUNDED, PARTIALLY_REFUNDED.
// PAID is ours, it only ever shows up on mock orders.
const PAID_STATUSES = new Set(["PROCESSED", "AUTHORIZED", "PAID"]);
// Webhook events that mean the same thing.
const PAID_EVENTS = new Set(["ORDER_PROCESSED", "ORDER_AUTHORIZED"]);

const app = express();

// ---------------------------------------------------------------- middleware

// Only the game frontend may call this server from a browser.
app.use(cors({ origin: FRONTEND_URL }));

// Keep the raw body around so webhook signatures can be checked byte for byte.
// Re-serialising the parsed JSON would change whitespace and break the hash.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
// Pine Labs may hit the browser callback as a POST form submit.
app.use(express.urlencoded({ extended: false }));

// ------------------------------------------------------------- in-memory db

// orderId (our merchant reference) -> { playerId, item, amount, status, pineOrderId, granted }
const orders = new Map();
// Pine Labs order_id -> our merchant reference, so webhooks can find the player.
const pineToLocal = new Map();
// playerId -> { item: count }
const inventory = new Map();

function lookupOrder(id) {
  if (!id) return null;
  if (orders.has(id)) return orders.get(id);
  const local = pineToLocal.get(id);
  return local ? orders.get(local) || null : null;
}

/**
 * Give the player what they paid for. Idempotent: webhooks retry, and the
 * callback and the webhook can both land, so this must be safe to call twice.
 */
function grantItem(playerId, item, orderId) {
  const order = orderId ? orders.get(orderId) : null;
  if (order && order.granted) {
    console.log(`[grant] skip, already granted order=${orderId}`);
    return;
  }

  const bag = inventory.get(playerId) || {};
  bag[item] = (bag[item] || 0) + 1;
  inventory.set(playerId, bag);
  if (order) order.granted = true;

  console.log(
    `[grant] playerId=${playerId} item=${item} order=${orderId || "n/a"} bag=${JSON.stringify(bag)}`
  );

  // TODO(spacetimedb): call the SpacetimeDB reducer here instead of the
  // in-memory map above, something like:
  //   await stdbClient.reducers.grantItem(playerId, item, orderId)
  // Keep the idempotency check, the reducer will be hit more than once.
}

// ------------------------------------------------------------- pine labs api

let tokenCache = { token: null, expiresAt: 0 };

/** Fetch an access token, cached until just before it expires. */
async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`${BASE}/api/auth/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Request-ID": crypto.randomUUID(),
      "Request-Timestamp": new Date().toISOString(),
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`token request failed: ${res.status} ${JSON.stringify(body)}`);
  }

  // The docs return expires_at as an ISO timestamp. Fall back to 10 minutes,
  // and always keep a 60s safety margin.
  const expiresAt = body.expires_at ? Date.parse(body.expires_at) : now + 10 * 60 * 1000;
  tokenCache = { token: body.access_token, expiresAt: expiresAt - 60 * 1000 };
  return tokenCache.token;
}

/** Headers every Pine Labs call needs. */
async function pineHeaders() {
  return {
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
    "Request-ID": crypto.randomUUID(),
    "Request-Timestamp": new Date().toISOString(),
  };
}

/** Generate Checkout Link. Returns { order_id, redirect_url, token }. */
async function createCheckout({ merchantOrderReference, amount, playerId, item }) {
  const payload = {
    merchant_order_reference: merchantOrderReference,
    order_amount: { value: amount, currency: CURRENCY },
    integration_mode: "REDIRECT",
    pre_auth: false,
    notes: `${item} for ${playerId}`,
    callback_url: `${PUBLIC_URL}/api/callback`,
    failure_callback_url: `${PUBLIC_URL}/api/callback`,
  };

  const res = await fetch(`${BASE}/api/checkout/v1/orders`, {
    method: "POST",
    headers: await pineHeaders(),
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.redirect_url) {
    throw new Error(`checkout request failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

/** Get Order by ID. Returns the order object from the data envelope. */
async function getOrder(pineOrderId) {
  const res = await fetch(`${BASE}/api/pay/v1/orders/${encodeURIComponent(pineOrderId)}`, {
    method: "GET",
    headers: await pineHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`get order failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data || body;
}

// -------------------------------------------------------- webhook signatures

/**
 * Verify a Pine Labs webhook.
 * Signed content is "webhook-id.webhook-timestamp.rawBody", HMAC-SHA256 with
 * the base64 decoded secret key, output base64. The webhook-signature header
 * looks like "v1,<base64>".
 */
function verifyWebhook(req) {
  if (!WEBHOOK_SECRET) {
    // Mock mode has no secret, so let local curl testing through. In real mode
    // a missing secret is a misconfiguration and must fail closed.
    return MOCK;
  }

  const id = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const header = req.get("webhook-signature");
  if (!id || !timestamp || !header || typeof req.rawBody !== "string") return false;

  // Reject anything older than 5 minutes to blunt replays.
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const expected = crypto
    .createHmac("sha256", Buffer.from(WEBHOOK_SECRET, "base64"))
    .update(`${id}.${timestamp}.${req.rawBody}`)
    .digest();

  // The header can carry several space separated versioned signatures.
  return header.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// ------------------------------------------------------------------ routes

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: MOCK ? "mock" : "real", base: MOCK ? null : BASE });
});

// 1. Start a purchase.
app.post("/api/buy", async (req, res) => {
  const { playerId, item } = req.body || {};
  if (!playerId || !item) {
    return res.status(400).json({ error: "playerId and item are required" });
  }
  const amount = PRICES[item];
  if (!amount) {
    return res.status(400).json({ error: `unknown item "${item}"`, items: Object.keys(PRICES) });
  }

  if (MOCK) {
    const orderId = `mock-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    orders.set(orderId, {
      playerId,
      item,
      amount,
      status: "PAID",
      pineOrderId: null,
      granted: false,
      mock: true,
    });
    grantItem(playerId, item, orderId);
    return res.json({ status: "PAID", orderId, checkoutUrl: null });
  }

  // merchant_order_reference doubles as Pine Labs' idempotency key, so it has
  // to be unique per attempt.
  const merchantOrderReference = `sp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  orders.set(merchantOrderReference, {
    playerId,
    item,
    amount,
    status: "CREATED",
    pineOrderId: null,
    granted: false,
    mock: false,
  });

  try {
    const checkout = await createCheckout({ merchantOrderReference, amount, playerId, item });
    const order = orders.get(merchantOrderReference);
    order.pineOrderId = checkout.order_id;
    if (checkout.order_id) pineToLocal.set(checkout.order_id, merchantOrderReference);

    res.json({ orderId: merchantOrderReference, checkoutUrl: checkout.redirect_url });
  } catch (err) {
    console.error("[buy] checkout failed:", err.message);
    orders.get(merchantOrderReference).status = "FAILED";
    res.status(502).json({ error: "could not create checkout" });
  }
});

// 2. Browser comes back here from the hosted checkout page.
// The redirect itself is not signed by Pine Labs, the docs are explicit that it
// is for customer experience only, so we never trust its fields. We re-read the
// status from the Get Order API and the webhook stays the source of truth.
async function handleCallback(req, res) {
  const fields = { ...req.query, ...req.body };
  const id =
    fields.order_id || fields.plural_order_id || fields.merchant_order_reference || fields.orderId;
  const order = lookupOrder(id);
  let paid = false;

  try {
    if (order && order.mock) {
      paid = PAID_STATUSES.has(order.status);
    } else if (order && order.pineOrderId) {
      const remote = await getOrder(order.pineOrderId);
      order.status = remote.status || order.status;
      paid = PAID_STATUSES.has(order.status);
      // Grant here too. The webhook may be slow and the player is watching.
      if (paid) grantItem(order.playerId, order.item, pineToLocal.get(order.pineOrderId));
    } else {
      console.warn(`[callback] unknown order id=${id}`);
    }
  } catch (err) {
    console.error("[callback] status check failed:", err.message);
  }

  const url = new URL(FRONTEND_URL);
  url.searchParams.set("paid", paid ? "1" : "0");
  if (id) url.searchParams.set("orderId", String(id));
  res.redirect(302, url.toString());
}

app.post("/api/callback", handleCallback);
// Handy during manual testing and harmless if Pine Labs ever uses GET.
app.get("/api/callback", handleCallback);

// 3. Webhook. This is the source of truth for granting items.
app.post("/api/webhook", (req, res) => {
  if (!verifyWebhook(req)) {
    console.warn("[webhook] rejected, bad or missing signature");
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = req.body || {};
  const data = event.data || {};
  const localId = data.merchant_order_reference || pineToLocal.get(data.order_id);
  const order = localId ? orders.get(localId) : null;

  console.log(
    `[webhook] ${event.event_type} order=${data.order_id} ref=${localId} status=${data.status}`
  );

  if (order) {
    order.status = data.status || order.status;
    if (data.order_id && !order.pineOrderId) {
      order.pineOrderId = data.order_id;
      pineToLocal.set(data.order_id, localId);
    }
    if (PAID_EVENTS.has(event.event_type) || PAID_STATUSES.has(data.status)) {
      grantItem(order.playerId, order.item, localId);
    }
  } else {
    console.warn(`[webhook] no local order for ref=${localId}`);
  }

  // Always 200 so Pine Labs does not retry a payload we have already handled.
  res.json({ received: true });
});

// 4. Status for one order.
app.get("/api/order/:id", async (req, res) => {
  const order = lookupOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "unknown order" });

  if (!order.mock && order.pineOrderId) {
    try {
      const remote = await getOrder(order.pineOrderId);
      order.status = remote.status || order.status;
    } catch (err) {
      console.error("[order] status check failed:", err.message);
    }
  }

  res.json({
    orderId: req.params.id,
    status: order.status,
    item: order.item,
    playerId: order.playerId,
    amount: order.amount,
    currency: CURRENCY,
    granted: order.granted,
    mock: order.mock,
  });
});

// Small extra, useful for the game client to show what a player owns.
app.get("/api/inventory/:playerId", (req, res) => {
  res.json({ playerId: req.params.playerId, items: inventory.get(req.params.playerId) || {} });
});

app.listen(PORT, () => {
  console.log(`space-pay listening on ${PORT} in ${MOCK ? "MOCK" : "REAL"} mode`);
  if (MOCK) console.log("set PINELABS_CLIENT_ID and PINELABS_CLIENT_SECRET to go live");
  else console.log(`pine labs base: ${BASE}`);
  console.log(`cors origin: ${FRONTEND_URL}`);
});
