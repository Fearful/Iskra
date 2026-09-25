// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed to Fly.io at the root of its domain (e.g. https://iskra-docs.fly.dev).
// `site` is used for absolute URLs (sitemap, canonical) — change it if you map a
// custom domain. No `base` is set, so the site is served from "/".
export default defineConfig({
    site: 'https://iskra-docs.fly.dev',
    integrations: [
        starlight({
            title: 'Iskra',
            description: 'A modular, high-performance framework for Bun with a hexagonal architecture.',
            logo: {
                src: './src/assets/logo.svg',
                alt: 'Iskra',
                replacesTitle: false,
            },
            social: [
                {
                    icon: 'github',
                    label: 'GitHub',
                    href: 'https://github.com/fearful/iskra',
                },
            ],
            // Pagefind full-text search is enabled by default in Starlight.
            pagefind: true,
            defaultLocale: 'root',
            locales: {
                root: { label: 'English', lang: 'en' },
                es: { label: 'Español', lang: 'es' },
            },
            editLink: {
                baseUrl: 'https://github.com/fearful/iskra/edit/main/website/',
            },
            sidebar: [
                {
                    label: 'Start Here',
                    translations: { es: 'Empezar' },
                    items: [{ slug: 'getting-started' }, { slug: 'configuration' }],
                },
                {
                    label: 'Concepts',
                    translations: { es: 'Conceptos' },
                    items: [{ slug: 'concepts/architecture' }, { slug: 'concepts/authoring' }],
                },
                {
                    label: 'Packages',
                    translations: { es: 'Paquetes' },
                    items: [
                        { slug: 'packages/core' },
                        { slug: 'packages/config-kit' },
                        { slug: 'packages/web-kit' },
                        { slug: 'packages/auth-kit' },
                        { slug: 'packages/db-kit' },
                        { slug: 'packages/socket-kit' },
                        { slug: 'packages/kv-kit' },
                        { slug: 'packages/cache-kit' },
                        { slug: 'packages/worker-kit' },
                        { slug: 'packages/process-kit' },
                        { slug: 'packages/mailer-kit' },
                        { slug: 'packages/storage-kit' },
                        { slug: 'packages/desktop-kit' },
                        { slug: 'packages/mobile-kit' },
                        { slug: 'packages/testing-kit' },
                        { slug: 'packages/create-iskra' },
                    ],
                },
                {
                    label: 'Guides',
                    translations: { es: 'Guías' },
                    items: [
                        { slug: 'guides/migrations' },
                        { slug: 'guides/security' },
                        { slug: 'guides/upgrading-to-0-2' },
                        { slug: 'guides/upgrading-typed-apis' },
                        { slug: 'guides/deployment' },
                        { slug: 'guides/sdks' },
                        { slug: 'templates' },
                    ],
                },
                {
                    label: 'API Reference',
                    translations: { es: 'Referencia de API' },
                    items: [{ slug: 'api' }],
                },
            ],
        }),
    ],
});
