# hacky-admin

A small local admin page for running Pine Labs AgenticOrg agents. It is its own
thing: it does not touch the game (`client/`, `module/`) and is not deployed.

## Run

```bash
cp .env.example .env    # then put your key in AGENTICORG_API_KEY
npm start
```

Open http://127.0.0.1:8790. No `npm install` needed, it has no dependencies
(Node 22 or newer).

## Use

1. Paste the agent's **UUID** (not a type name like `ap_processor`). Agents you
   ran before, and any the key is allowed to list, show up as suggestions.
2. Type the task and press **Run agent**. The page sends
   `{"action": "process", "inputs": {"task": "..."}, "context": {}}`.
   Agents that want other input keys: open *Custom inputs and context*.
3. You see the `status`, `confidence` and `output`:
   - `completed`: done.
   - `failed`: the run failed, details in the output.
   - `hitl_triggered`: waiting for approval in the AgenticOrg UI.
   - `budget_exceeded`: the agent hit its spend limit.

Sync runs wait up to about 120 s. For longer ones tick **Long run (async)**: it
calls `run-async`, which answers 202 right away, then use **Check status**.

## How the key stays safe

The browser only talks to `server.js` on 127.0.0.1. The server reads
`AGENTICORG_API_KEY` from `.env` and adds the `Authorization: Bearer` header
itself, so the key is never sent to the page and `.env` is never committed.

| Local route | Forwards to |
| --- | --- |
| `POST /api/run` | `POST {BASE}/api/v1/agents/{id}/run` (or `/run-async`) |
| `GET /api/agents` | `GET {BASE}/api/v1/agents` |
| `GET /api/status?path=` | `GET {BASE}{path}` for an async run |
| `GET /api/health` | nothing, says whether a key is set |
