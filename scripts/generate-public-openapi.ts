import { mkdirSync, writeFileSync } from 'node:fs'

import { buildServiceCredentialOpenApi } from '#/lib/public-api-openapi'

const spec = buildServiceCredentialOpenApi()
mkdirSync('docs/openapi', { recursive: true })
writeFileSync(
  'docs/openapi/service-credentials-v0.json',
  `${JSON.stringify(spec, null, 2)}\n`,
)
