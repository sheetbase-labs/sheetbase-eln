import { mkdirSync, writeFileSync } from 'node:fs'

import { buildExternalApiOpenApi } from '#/lib/public-api-openapi'

const spec = buildExternalApiOpenApi()
mkdirSync('docs/api/openapi', { recursive: true })
writeFileSync(
  'docs/api/openapi/external-api-v0.json',
  `${JSON.stringify(spec, null, 2)}\n`,
)
