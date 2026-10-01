---
name: Bug Report
about: Report a protocol violation, cache inconsistency, or crash
title: "bug: "
labels: needs-triage
assignees: ''
---

### Expected Behavior
<!-- What should have happened according to RFC 9111 or the Boombox spec? -->

### Actual Behavior
<!-- What actually happened (status code, headers, error log)? -->

### Minimal Steps to Reproduce
1. Start proxy: `bun bin/boombox.js --port ... --origin ...`
2. Send request: `curl -i ...`
3. Observe output: ...

### Environment
- **Runtime**: Bun (`bun --version`)
- **OS**: Windows / Linux / macOS
