---
title: create-iskra
description: Project scaffolding CLI for Iskra.
---

Scaffolding CLI for Iskra. Create a brand-new project from an official template with a single command.

## Quick Start

```bash
bun create iskra my-app
```

The command prompts for a directory and template if you do not pass them, copies the chosen template, and leaves the project ready for `bun install`.

Non-interactive mode:

```bash
bun create iskra my-app --template simple-server --yes
```

It also works with npm:

```bash
npm create iskra@latest my-app
```

## What it does

1. Copies the chosen template into `my-app/`, excluding `node_modules`, `dist`, and `.git`.
2. Rewrites `package.json`: sets `name` to the target directory's basename and replaces every `@iskra-bun/* : workspace:*` dependency with a caret range on that package's current version (e.g. `^0.2.0` for `web-kit`, `^0.1.1` for `core`).
3. Prints the next steps (`cd`, `bun install`, `bun start`).

If the target directory already exists and is non-empty, the command aborts without touching anything.

## Options

```bash
create-iskra [directory] [--template <name>] [--yes]
```

| Option | Description |
| --- | --- |
| `[directory]` | Directory to create the project in. Prompted if missing. |
| `-t, --template <name>` | Template to use. Default: `starter-app`. |
| `-y, --yes` | Accept defaults without prompting. |
| `-h, --help` | Show help. |

## Bundled templates

- `starter-app` — minimal web server with user management (default).
- `simple-server` — minimal HTTP server.

More templates are on the way.

## Programmatic API

The copy logic is importable and does not depend on the interactive prompt:

```typescript
import { scaffold } from 'create-iskra';

scaffold({
    template: 'starter-app',
    targetDir: './my-app',
    projectName: 'my-app',
    templatesRoot: '/path/to/templates',
});
```
