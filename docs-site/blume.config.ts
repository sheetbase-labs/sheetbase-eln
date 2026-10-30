import { defineConfig } from 'blume'

export default defineConfig({
  title: 'Sheetbase docs',
  description:
    'Run Sheetbase for your lab: install, sign-in, files, backups, upgrades and the API.',
  content: {
    // The Markdown the repository already keeps next to the code.
    root: '../docs',
    // Product history, roadmaps and design records are working notes, not the
    // manual. They stay in the repository.
    exclude: ['README.md', 'knowledge/**', 'development/screenshots/**'],
  },
  github: { owner: 'sheetbase-labs', repo: 'sheetbase-eln', branch: 'main' },
})
