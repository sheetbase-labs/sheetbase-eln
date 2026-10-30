# Documentation site

The manual is built from the Markdown in [`../docs`](../docs) with
[Blume](https://useblume.dev) (MIT, built on Astro). The site only reads the
Markdown; nothing in `docs/` depends on it, and GitHub still renders every page.

```bash
cd docs-site
pnpm install --ignore-workspace
npx blume dev        # local preview with hot reload
npx blume validate   # check links and anchors
npx blume build      # static site into docs-site/dist
```

Run Blume with `npx` rather than `pnpm run`: from inside `docs-site`, pnpm also
checks the app's dependencies in the parent folder before running a script.

`dist/` is plain HTML, so any static host works. Set `deployment.site` in
`blume.config.ts` to the public address to get a sitemap and canonical links.

What is published is set by `content` in `blume.config.ts`: product history,
roadmaps and design records under `docs/knowledge/` stay in the repository only.
When a page links to a file outside the published set, link to it on GitHub so
the link works in both places.
