import { describe, expect, it } from 'vitest'

import {
  buildConnectorConfig,
  configFormValues,
  missingConfigLabels,
} from './config-form'

describe('connector config form', () => {
  it('names the required settings an unconfigured connector lacks', () => {
    expect(missingConfigLabels('s3', { adapter: 's3' })).toEqual(['bucket'])
    expect(missingConfigLabels('postgres', { adapter: 'postgres' })).toEqual([
      'host',
      'port',
      'database',
    ])
    expect(
      missingConfigLabels('s3', { adapter: 's3', bucket: 'lab-data' }),
    ).toEqual([])
  })

  it('keeps keys the form does not own, because the RPC replaces config wholesale', () => {
    const existing = { adapter: 'postgres', allowedSchemas: ['lims'] }
    const values = {
      ...configFormValues('postgres', existing),
      host: ' db.example.org ',
      port: '5432',
      database: 'lims',
    }
    expect(buildConnectorConfig('postgres', existing, values)).toEqual({
      ok: true,
      config: {
        adapter: 'postgres',
        allowedSchemas: ['lims'],
        host: 'db.example.org',
        port: 5432,
        database: 'lims',
        sslMode: 'disable',
      },
    })
  })

  it('reports field-level errors and drops cleared optional values', () => {
    const bad = buildConnectorConfig(
      'postgres',
      {},
      {
        ...configFormValues('postgres', {}),
        host: 'h',
        port: '99999',
        database: '',
      },
    )
    expect(bad).toMatchObject({
      ok: false,
      errors: { port: expect.any(String), database: expect.any(String) },
    })
    const cleared = buildConnectorConfig(
      's3',
      { adapter: 's3', bucket: 'b1', prefix: 'old/' },
      { ...configFormValues('s3', { bucket: 'b1' }), prefix: '' },
    )
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.config).not.toHaveProperty('prefix')
  })
})
