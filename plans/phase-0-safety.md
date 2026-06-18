# Prompt Plan — Phase 0: Safety & Foundation

> Goal: get the working tree clean and under a fresh git history with no leaked secrets or internal references. Gate for everything else.
> Type: `--type refactor`. Domain: Bun + TypeScript monorepo.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Test | `bun test` |
| Lint | `bun run lint` |
| Secret scan | `gitleaks detect --no-git --source .` (install if missing) |

## Tasks

- [ ] Task 1: Run a secret scan over the working tree (`gitleaks detect --no-git --source .`, fallback `trufflehog filesystem .`). Produce a report of any findings (file:line, type). Do NOT auto-delete — list for review. Owns: report only (no edits). 
- [ ] Task 2: Audit all tracked-candidate files for internal references and list them: any internal Docker/npm registry, internal hostnames, IPs, or real values in `.env*`. (The former internal GitLab registry CI was already removed.) Produce a remediation list (file:line → suggested replacement/placeholder). Owns: report only. (depends: none)
- [ ] Task 3: Sanitize any internal references found in Task 2 — replace registry URLs/hostnames with placeholders or remove, parameterize via env. Owns: any config files flagged. (depends: Task 2)
- [ ] Task 4: Write/verify a comprehensive root `.gitignore` (node_modules, .env, .env.*, storage/, dist/, .claude/, *.db, coverage/, .DS_Store, bun build artifacts). Owns: `.gitignore`. (depends: none)
- [ ] Task 5: Initialize git (`git init`, default branch `main`), stage everything honoring `.gitignore`, and make ONE clean initial commit `chore: initial public commit`. Verify `git status` clean and `git log` shows a single commit. (depends: Task 1, Task 3, Task 4)

## Acceptance

- gitleaks reports 0 secrets (or all reviewed & cleared).
- No internal hostnames/registry URLs in tracked files.
- Repo initialized; `git log --oneline` shows exactly one clean commit on `main`.
- `bun test` still 0 fail.
