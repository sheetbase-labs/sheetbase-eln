import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { FieldForm, readFieldValues } from '#/components/plugins/field-form'
import type { FieldValues } from '#/components/plugins/field-form'
import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import type { ExtensionConnectorDeclaration } from '#/lib/extensions/data-points'
import type { ExtensionField } from '#/lib/extensions/points'
import { pullWithConnector } from '#/lib/extensions/plugin-files'
import type { RunnerItem } from '#/lib/extensions/runner-points'

type Connector = RunnerItem<ExtensionConnectorDeclaration>

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Connectors that installed plugins add, on the import page. The person fills
 * in what the connector asks for and presses Pull; the data arrives as a table
 * and is handed to the import flow as a file, so mapping, checks and the
 * receipt are the ones every import has.
 */
export function PluginPullPanel({
  connectors,
  onFile,
}: {
  connectors: Connector[]
  onFile: (file: File) => void | Promise<void>
}) {
  const [name, setName] = useState(connectors[0]?.name ?? '')
  const [values, setValues] = useState<FieldValues>({})
  const [missing, setMissing] = useState<string | null>(null)
  const active = connectors.find((c) => c.name === name) ?? connectors[0]
  const declaration = active.declaration

  const settingFields: ExtensionField[] = declaration.settings.map(
    (setting) => ({
      name: `setting_${setting.name}`,
      type: 'text',
      required: setting.required,
      label: setting.label,
    }),
  )

  const parameterFields = declaration.parameters

  const pull = useMutation({
    mutationFn: async () => {
      const parameters = readFieldValues(parameterFields, values)
      const settings = readFieldValues(settingFields, values)

      if (!parameters.ok) {
        setMissing(parameters.missing[0])

        return undefined
      }

      if (!settings.ok) {
        setMissing(settings.missing[0])

        return undefined
      }

      setMissing(null)

      const file = await pullWithConnector({
        extensionKey: active.extensionKey,
        connectorId: active.id,
        name: slug(declaration.title) || 'pulled-data',
        parameters: parameters.input,
        settings: Object.fromEntries(
          declaration.settings.flatMap((setting) => {
            const value = settings.input[`setting_${setting.name}`]

            return typeof value === 'string' ? [[setting.name, value]] : []
          }),
        ),
      })

      await onFile(file)

      return file
    },
  })

  return (
    <section
      aria-label={t('plugins.import.pullTitle')}
      className="grid max-w-[640px] gap-3 rounded-md border border-border p-3"
    >
      <div className="grid gap-1">
        <h2 className="m-0 text-body font-medium text-fg">
          {t('plugins.import.pullTitle')}
        </h2>
        <p className="m-0 text-label text-fg-muted">
          {t('plugins.import.pullHint')}
        </p>
      </div>
      {connectors.length > 1 ? (
        <label className="flex flex-col gap-1 text-label">
          <span className="font-medium text-fg">
            {t('plugins.import.choose')}
          </span>
          <Select
            value={active.name}
            aria-label={t('plugins.import.choose')}
            onChange={(event) => {
              setName(event.target.value)
              setValues({})
              setMissing(null)
              pull.reset()
            }}
          >
            {connectors.map((connector) => (
              <option key={connector.name} value={connector.name}>
                {connector.declaration.title}
              </option>
            ))}
          </Select>
        </label>
      ) : (
        <p className="m-0 text-body font-medium text-fg">{declaration.title}</p>
      )}
      <p className="m-0 text-label text-fg-muted">
        {declaration.description}{' '}
        {t('plugins.import.from', {
          name: active.extensionName,
          hosts: declaration.hosts.join(', '),
        })}
      </p>
      <FieldForm
        fields={[...parameterFields, ...settingFields]}
        masked={declaration.settings
          .filter((setting) => setting.secret)
          .map((setting) => `setting_${setting.name}`)}
        values={values}
        onChange={setValues}
      />
      {declaration.settings.length > 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('plugins.import.settingsNote')}
        </p>
      ) : null}
      {missing ? (
        <p role="status" className="m-0 text-label text-danger-text">
          {t('plugins.import.needs', { name: missing })}
        </p>
      ) : null}
      {pull.error ? (
        <Banner tone="bad" title={t('plugins.import.pull')}>
          {t('plugins.import.failed', { reason: pull.error.message })}
        </Banner>
      ) : null}
      <div>
        <Button
          variant="secondary"
          disabled={pull.isPending}
          onClick={() => pull.mutate()}
        >
          {pull.isPending
            ? t('plugins.import.pulling')
            : t('plugins.import.pull')}
        </Button>
      </div>
    </section>
  )
}
