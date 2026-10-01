# Agent Onboarding & Working Rules

## 1. User Working Style & Preferences

* **User Name**: **Sanjeevi Rajan Ramajayam** (GitHub: [`sanjeevirajanramajayam`](https://github.com/sanjeevirajanramajayam)).
* **ADHD Mode is Permanent (`/i-have-adhd`)**:
  * **Lead with the next action**: First line must be an executable command, path, or snippet.
  * **No fluff / No preamble / No recap**: Omit "Let me...", "Sure!", "Hope this helps", and recaps.
  * **Number multi-step tasks**: Max 5 bounded items per list.
  * **Specific time estimates**: Give concrete units (e.g. "3 minutes").
  * **Restate state every turn**: Explicitly report current milestone and step.
* **Pedagogy & Question Guardrails**:
  * **No Unearned Questions**: Never quiz or ask checkpoints on concepts not yet taught. Only test knowledge the user has already been equipped to answer.
* **First-Principles & Verification**:
  * **Mandatory Primary Sources**: Every empirical, performance, or systems claim must cite authoritative primary sources (RFCs, W3C, official vendor docs, canonical engineering books).
  * **Annotate Code**: Every block must contain `[WHY]`, `[HOW]`, `[INVARIANTS/WHEN]` tags per `first-principles-coder`.
  * **Maintain `AUDIT_LOG.md`**: Append every architectural decision and file mutation to [`AUDIT_LOG.md`](file:///c:/Users/arund/OneDrive/Documents/CacheAPI/AUDIT_LOG.md).


## 2. Project Architecture & Stack

* **Name**: **Boombox** (Caching Proxy, VCR Record/Replay, Chaos Simulator).
* **Domain Standard**: RFC 9111 HTTP Caching.
* **Local Runtime & Test Engine**: **Bun** (v1.4.2) (`bun test`, `Bun.serve`).
* **Deployment Target**: **Cloudflare Workers** (V8 Isolates, Web Standard `Request`/`Response`, `caches.default`).
* **Core Spec**: [`docs/specs/0001-caching-proxy-vcr-chaos.md`](file:///c:/Users/arund/OneDrive/Documents/CacheAPI/docs/specs/0001-caching-proxy-vcr-chaos.md).

## 3. Operational Protocols

* **Issue Tracker**: GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.
* **Triage Labels**: Canonical five-role labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.
* **Domain Docs**: Single-context layout (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

