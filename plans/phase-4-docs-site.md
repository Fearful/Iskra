# Prompt Plan — Phase 4: Documentation Website (Starlight + i18n)

> Goal: a deployed, searchable docs site on Starlight (Astro), English-primary + Spanish-secondary, covering all kits plus the missing Getting-Started / API-reference content.
> Type: `--type feature`. Deploy target: GitHub Pages (`<github-org>.github.io/iskra`).

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Dev | `cd website && bun run dev` |
| Build | `cd website && bun run build` |
| Link check | `lychee` over built output (CI) |

## Tasks

- [ ] Task 1: Scaffold Astro + Starlight in `website/`. Configure i18n with `en` (default/root) + `es`, set `base: '/iskra'` for Pages, enable Pagefind search. Owns: `website/**` (config, package.json, astro.config). 
- [ ] Task 2: Migrate the existing Spanish docs (`docs/*.md`: arquitectura, core, web-kit, db-kit, socket-kit, kv-kit, worker-kit, process-kit, desktop-kit, mobile-kit, configuracion, migraciones, despliegue, sdks) into `website/src/content/docs/es/`. Owns: `website/src/content/docs/es/**`. (depends: Task 1)
- [ ] Task 3: Translate all migrated pages to English under `website/src/content/docs/en/`. Keep code blocks identical; translate prose. Owns: `website/src/content/docs/en/**`. (depends: Task 2)
- [ ] Task 4: Author a true end-to-end **Getting Started** tutorial (install → build a small Web+DB API → run → test → deploy), in EN + ES. Owns: `website/src/content/docs/{en,es}/getting-started.md`. (depends: Task 1)
- [ ] Task 5: Author a **Concepts/Architecture** page (hexagonal, Drivers vs Plugins, App lifecycle) and a **Plugin/Driver authoring guide**, EN + ES. Owns: `website/src/content/docs/{en,es}/concepts*.md`, `.../authoring*.md`. (depends: Task 1)
- [ ] Task 6: Build a **Templates gallery** page indexing all `templates/*` with one-liners + run commands, EN + ES. Owns: `website/src/content/docs/{en,es}/templates.md`. (depends: Task 1)
- [ ] Task 7: Generate an **API reference** with TypeDoc from package sources; integrate into the site (linked section or embedded). Owns: `website/api/**`, typedoc config. (depends: Task 1)
- [ ] Task 8: Build the **landing page** (hero, feature grid, install snippet) and add **Experimental** badges/callouts to the desktop-kit / mobile-kit / db-oracle pages. Owns: `website/src/content/docs/{en,es}/index.mdx`, splash components. (depends: Task 2, Task 3)
- [ ] Task 9: Complete `.github/workflows/docs.yml` — build `website/` and deploy to GitHub Pages on push to `main`; add a `lychee` link-check step that fails on broken links. Owns: `.github/workflows/docs.yml`. (depends: Task 1)

## Acceptance

- `cd website && bun run build` succeeds; Pagefind search index generated.
- EN + ES both fully navigable; no broken internal links (lychee clean).
- Getting-Started, Concepts, Templates, API reference all present.
- Site deploys and is reachable at the Pages URL.
