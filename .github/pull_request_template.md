## Description & First-Principles Rationale

### 1. Intent (Why)
<!-- What problem does this solve? What protocol, RFC, or operational constraint forced this change? -->

### 2. Implementation Mechanics (How)
<!-- How does this modify system state or request/response pipelines? -->

### 3. Invariants & Safety (Check)
<!-- What guarantees remain true before and after this change? -->

## Protocol & RFC Checklist

- [ ] Complies with RFC 9111 (safe method caching rules).
- [ ] Hop-by-hop headers sanitized per RFC 9110 §7.6.1.
- [ ] Telemetry headers (`X-Cache`) set accurately (`HIT`, `MISS`, `BYPASS`, `RECORD`, `REPLAY`).
- [ ] First-principles commentary blocks (`[WHY]`, `[HOW]`, `[INVARIANTS/WHEN]`) included on code blocks.
- [ ] Zero-network invariant maintained if modifying VCR replay mode.

## Verification Evidence

- [ ] All tests pass locally via `bun test`.
<!-- Paste bun test terminal output snippet below -->
```
```
