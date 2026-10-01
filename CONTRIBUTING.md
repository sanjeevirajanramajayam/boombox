# Contributing to Boombox 📻

Thank you for your interest in contributing to Boombox! This project is built on **first principles**, **RFC 9111 HTTP caching specifications**, and **Bun**.

---

## Quick Development Setup

1. **Prerequisites**: Install [Bun](https://bun.sh) (v1.4+).
2. **Clone & Setup**:
   ```bash
   git clone https://github.com/sanjeevirajanramajayam/boombox.git
   cd boombox
   ```
3. **Run the Test Suite**:
   ```bash
   bun test
   ```
   All tests run across ephemeral TCP loopback sockets in $<200\text{ ms}$.

---

## Architectural Rules & Standards

When authoring code or proposing features:

1. **RFC 9111 Compliance**: Caching behavior must adhere strictly to [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html). Never cache mutating verbs (`POST`, `PUT`, `DELETE`).
2. **Hop-by-Hop Sanitization**: Never forward or cache connection-specific headers per RFC 9110 §7.6.1 (`transfer-encoding`, `connection`, `keep-alive`, etc.).
3. **VCR Zero-Network Invariant**: In `--mode replay`, code must NEVER initiate outbound network connections. Unrecorded tracks must fail fast with `502 Bad Gateway`.
4. **Code Quality & Tests**: Write readable, idiomatic JavaScript with accompanying `bun test` coverage for any new behavioral paths.

---

## Submitting Pull Requests

1. Create a feature branch: `git checkout -b feat/my-new-feature`.
2. Write automated tests in `test/` verifying observable HTTP behavior over sockets.
3. Ensure `bun test` passes with zero failures.
4. Fill out the [Pull Request Template](.github/pull_request_template.md).
5. All PRs are automatically reviewed against RFC compliance and tested via GitHub Actions.

---

## Questions & Issues

- Find open issues ready for contributors labelled [`ready-for-agent`](https://github.com/sanjeevirajanramajayam/boombox/labels/ready-for-agent) or [`ready-for-human`](https://github.com/sanjeevirajanramajayam/boombox/labels/ready-for-human).
- File bugs or feature proposals using our [Issue Templates](https://github.com/sanjeevirajanramajayam/boombox/issues/new/choose).
