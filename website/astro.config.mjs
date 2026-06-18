// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages: fearful.github.io/iskra -> base path "/iskra"
export default defineConfig({
  site: 'https://fearful.github.io',
  base: '/iskra',
  integrations: [
    starlight({
      title: 'Iskra',
      description:
        'A modular, high-performance framework for Bun with a hexagonal architecture.',
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
          items: [
            { slug: 'getting-started' },
            { slug: 'configuration' },
          ],
        },
        {
          label: 'Concepts',
          translations: { es: 'Conceptos' },
          items: [
            { slug: 'concepts/architecture' },
            { slug: 'concepts/authoring' },
          ],
        },
        {
          label: 'Packages',
          translations: { es: 'Paquetes' },
          items: [
            { slug: 'packages/core' },
            { slug: 'packages/web-kit' },
            { slug: 'packages/db-kit' },
            { slug: 'packages/socket-kit' },
            { slug: 'packages/kv-kit' },
            { slug: 'packages/worker-kit' },
            { slug: 'packages/process-kit' },
            { slug: 'packages/desktop-kit' },
            { slug: 'packages/mobile-kit' },
          ],
        },
        {
          label: 'Guides',
          translations: { es: 'Guías' },
          items: [
            { slug: 'guides/migrations' },
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
