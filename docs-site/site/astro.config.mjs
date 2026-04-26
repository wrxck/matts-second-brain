import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://matts-second-brain.hesketh.pro',
  integrations: [
    starlight({
      title: "Matt's Second Brain",
      description:
        'A persistent Claude Code knowledge brain backed by Trilium / Obsidian / Notion. Standards, decisions, lessons learned, and per-app context that survive across sessions.',
      social: {
        github: 'https://github.com/wrxck/matts-second-brain',
      },
      editLink: {
        baseUrl: 'https://github.com/wrxck/matts-second-brain/edit/main/docs-site/site/',
      },
      sidebar: [
        { label: 'Getting Started', autogenerate: { directory: 'getting-started' } },
        { label: 'Backends', autogenerate: { directory: 'backends' } },
        { label: 'MCP Tools', autogenerate: { directory: 'mcp' } },
        { label: 'Plugin', autogenerate: { directory: 'plugin' } },
      ],
    }),
  ],
});
