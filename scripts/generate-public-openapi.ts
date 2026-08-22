import { mkdirSync, writeFileSync } from 'node:fs'

import { buildExternalApiOpenApi } from '#/lib/public-api-openapi'

const spec = buildExternalApiOpenApi()
mkdirSync('docs/openapi', { recursive: true })
writeFileSync(
  'docs/openapi/external-api-v0.json',
  `${JSON.stringify(spec, null, 2)}\n`,
)
