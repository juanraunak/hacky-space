// hacky-admin: tiny local admin page that runs Pine Labs AgenticOrg agents.
// Totally separate from the game. No dependencies, just Node 22+.
//
// The browser never sees the API key: the page calls this server, and this
// server adds the Authorization header and forwards to AgenticOrg.
//
//   POST {BASE}/api/v1/agents/{id}/run         sync, up to ~120 s
//   POST {BASE}/api/v1/agents/{id}/run-async   202 for long runs
//   GET  {BASE}/api/v1/agents                  list agents (if the key may)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8790;
const HOST = process.env.HOST || "127.0.0.1";
const BASE = (process.env.AGENTICORG_BASE_URL || "https://agenticorg.hackathon.pinelabs.com").replace(/\/+$/, "");
const KEY = process.env.AGENTICORG_API_KEY || "";
const TIMEOUT_MS = 125_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = path.join(__dirname, "public", "index.html");

async function upstream(method, urlPath, body) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        reject(new Error("body is not JSON"));
      }
    });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(PAGE).pipe(res);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, base: BASE, hasKey: Boolean(KEY) });
  }

  if (!KEY) return send(res, 500, { error: "AGENTICORG_API_KEY is not set. Put it in admin/.env and restart." });

  if (req.method === "GET" && url.pathname === "/api/agents") {
    const r = await upstream("GET", "/api/v1/agents");
    return send(res, r.status, r.data);
  }

  // Check on an async run: the page passes back whatever status path the 202 gave it.
  if (req.method === "GET" && url.pathname === "/api/status") {
    const p = url.searchParams.get("path") || "";
    if (!p.startsWith("/api/v1/")) return send(res, 400, { error: "status path must start with /api/v1/" });
    const r = await upstream("GET", p);
    return send(res, r.status, r.data);
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    const { agentId, task, inputs, context, async: isAsync } = await readJson(req);
    if (!UUID.test(agentId || "")) return send(res, 400, { error: "Agent ID must be the agent's UUID, not a type name." });
    const body = {
      action: "process",
      inputs: inputs && typeof inputs === "object" ? inputs : { task: String(task || "") },
      context: context && typeof context === "object" ? context : {},
    };
    const suffix = isAsync ? "run-async" : "run";
    const started = Date.now();
    const r = await upstream("POST", `/api/v1/agents/${agentId}/${suffix}`, body);
    return send(res, 200, { httpStatus: r.status, ms: Date.now() - started, result: r.data });
  }

  send(res, 404, { error: "not found" });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      const timedOut = err.name === "TimeoutError";
      send(res, timedOut ? 504 : 502, {
        error: timedOut ? "AgenticOrg did not answer within 120 s. Try the async run." : String(err.message || err),
      });
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`hacky-admin on http://${HOST}:${PORT}  ->  ${BASE}`);
    if (!KEY) console.log("AGENTICORG_API_KEY is not set yet: copy .env.example to .env and fill it in.");
  });
