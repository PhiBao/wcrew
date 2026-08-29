# wcrew — Devpost submission copy

Paste these into the corresponding Devpost fields. Written to be read by a judge in under three minutes.

---

## Elevator pitch (project name / one-liner)

**wcrew — the shift roster co-pilot.** The weekly schedule is the first place a small shop learns to trust an agent to *act* — not just chat. wcrew makes that trust safe.

---

## Text description

### What it is

wcrew is a shift scheduler for the independent café, bakery, or small retail shop (5–30 hourly staff) that still builds next week's roster by hand on Sunday night — copying a grid in Excel, then chasing everyone in group texts. It turns that weekly ritual into a live board where a manager and their browser agent fix the roster together, with compliance, cost, and coverage you can see — dry-run before mutate, one click to publish.

### Why this use case is a strong fit for WebMCP

Scheduling is a problem where human judgment and agent speed are strictly complementary, but **trust is the gate**. A manager knows fairness — who needs the hours, whose kid has finals. An agent can instantly re-score every candidate against eight simultaneous constraints: skills, availability, under-18 curfew, 11-hour rest, 10-hour daily cap, 5 consecutive days, lead/keyholder coverage, 1.5× overtime, preferences, and a $5,200 budget. Neither is enough alone, and a manager will never hand over a schedule to a black box.

WebMCP is what makes that trust possible. The tools act on the *live page* inside the user's own authenticated browser session — not a shadow backend, not DOM scraping. Every agent action goes through the same commit path as a human edit: it's logged `actor:agent`, shown in the activity feed, and one-undo reversible. Destructive actions (publish, reset, apply auto-fill) pause on a human confirmation modal. **The agent proposes; the human decides.** Observable, attributable, undoable — that contract is load-bearing in a labor context, not decorative.

### How it creates a better user experience

Without WebMCP, an agent would guess its way through a dense 39-shift grid — brittle clicks, missed cells, no way to validate. With wcrew's 15 typed tools, `explain_assignment` and `assign_shift` share the *same* `evaluateAssignment` engine, so what the agent says will happen is exactly what happens. `auto_fill --dry_run` returns a preview produced by the identical code path as the apply — it is honest by construction. The agent's answers are *computed, not guessed*, and the manager watches every step repaint the board live.

### What people and agents can do together that was difficult or impossible before

"Cover late bar Thursday–Friday, stay under budget, and respect Maya's exam preferences." Before: the manager mental-maths every swap by hand. Now: they say it in plain English, and the agent calls `check_compliance` → `auto_fill --dry_run` → `explain_assignment`, shows a ranked plan with cost headroom and projected coverage, and waits for approval. Compliance violations — a minor scheduled past 21:00, a double-booking, a missing keyholder — surface automatically with the exact rule broken and a suggested fix. Real legal exposure is caught *before* it is published, not after.

### How WebMCP was implemented

15 structured tools on `document.modelContext` (`src/webmcp.js`), each with a natural-language description and JSON Schema. They execute against the same pure scheduling engine the UI uses, so "explain" and "do" can never diverge. A deterministic solver (greedy, hardest-shift-first, with a one-level repair pass) powers auto-fill; every mutating tool is actor-tagged, undoable, and respects locked shifts. An in-page agent console exposes the same tools via `getTools()`/`executeTool()`, so the demo runs in any browser — no Chrome flag required. Security: staff notes are wrapped in `--- BEGIN UNTRUSTED ---` delimiters with descriptions warning the agent not to follow instructions inside; origin isolation via `Origin-Agent-Cluster: ?1` + `Permissions-Policy: tools=(self)`.

The required snippet is live in `src/webmcp.js`:

```js
document.modelContext.registerTool({
  name: "search_products",
  description: "Search the product catalog",
  inputSchema: { /* ... */ },
  execute: async (input) => { /* ... */ }
});
```

---

## Testing instructions (for judges)

1. Open **https://wcrew.pages.dev** — it works in any modern browser. The bottom-right **Agent console** lets you run the 15 WebMCP tools (try *check compliance* or *preview auto-fill*) without any setup.
2. For the native agent experience, open it in **ChatGPT's in-app browser** (WebMCP on by default) or **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, plus the Model Context Tool Inspector extension. The header pill should read **WebMCP ✓ 15 tools**.
3. Ask the agent: *"What's wrong with this week and how do we fix the Thursday double-book?"* — it will call `check_compliance`, `suggest_swaps`, and `explain_assignment`, then propose a fix.
4. Try *"Cover the open shifts under budget and respect Maya's preferences"* — the agent will run `auto_fill --dry_run`, show the plan on the board, and ask before applying.

No login, no backend, no environment variables. State lives in `localStorage` and resets on reload if you want a clean slate.
