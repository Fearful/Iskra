# Security Policy

## Supported versions

Iskra is pre-1.0. Security fixes are applied to the latest `0.1.x` release line.

| Version | Supported |
| :------ | :-------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

The experimental kits (`@iskra-bun/desktop-kit`, `@iskra-bun/mobile-kit`, `@iskra-bun/db-oracle`) are provided as-is and are not yet covered by the same support guarantees.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub Security Advisories:

> https://github.com/fearful/iskra/security/advisories/new

Include, where possible:

- affected package(s) and version(s),
- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any suggested remediation.

## What to expect

- **Acknowledgement** within **72 hours**.
- An initial assessment and severity triage shortly after.
- Coordinated disclosure: we'll agree on a timeline and credit you in the release notes (unless you prefer to remain anonymous).

## Scope

This policy covers the code in this repository (the `@iskra-bun/*` packages and templates). Vulnerabilities in third-party dependencies should be reported upstream, though we welcome a heads-up so we can bump or mitigate.

Iskra is licensed under AGPL-3.0-or-later; the usual no-warranty terms of that license apply.
