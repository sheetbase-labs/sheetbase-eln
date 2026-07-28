import { useEffect, useState } from 'react'

import { Button, Input, Label, Select, Textarea } from '#/components/ui'
import type {
  JsonObject,
  RegistrationMode,
  WorkspaceSettings,
} from '#/lib/workspace-admin'

function json(value: JsonObject) {
  return JSON.stringify(value, null, 2)
}

export function AdminSettings({
  settings,
  isOwner,
  onSave,
  saving,
}: {
  settings: WorkspaceSettings | null
  isOwner: boolean
  onSave: (partial: Partial<WorkspaceSettings>) => void
  saving: boolean
}) {
  const [registrationMode, setRegistrationMode] =
    useState<RegistrationMode>('invitation_only')
  const [reviewEnabled, setReviewEnabled] = useState(false)
  const [reviewConfig, setReviewConfig] = useState('{}')
  const [signaturePolicy, setSignaturePolicy] = useState('{}')
  const [retention, setRetention] = useState(365)
  const [integrations, setIntegrations] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (settings) {
      setRegistrationMode(settings.registrationMode)
      setReviewEnabled(settings.reviewWorkflowEnabled)
      setReviewConfig(json(settings.reviewWorkflowConfig))
      setSignaturePolicy(json(settings.signaturePolicy))
      setRetention(settings.auditRetentionDays)
      setIntegrations(json(settings.integrationSettings))
    }
  }, [settings])
  function save() {
    try {
      onSave({
        registrationMode,
        reviewWorkflowEnabled: reviewEnabled,
        reviewWorkflowConfig: JSON.parse(reviewConfig) as JsonObject,
        signaturePolicy: JSON.parse(signaturePolicy) as JsonObject,
        auditRetentionDays: retention,
        integrationSettings: JSON.parse(integrations) as JsonObject,
      })
      setError(null)
    } catch {
      setError('Configuration fields must contain valid JSON objects.')
    }
  }
  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Registration mode</h2>
        <Label htmlFor="registration-mode">Who can register</Label>
        <Select
          id="registration-mode"
          disabled={!isOwner}
          value={registrationMode}
          onChange={(e) =>
            setRegistrationMode(e.target.value as RegistrationMode)
          }
        >
          <option value="open">Open</option>
          <option value="invitation_only">Invitation only</option>
        </Select>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Review workflow</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewEnabled}
            disabled={!isOwner}
            onChange={(e) => setReviewEnabled(e.target.checked)}
          />{' '}
          Enabled
        </label>
        <Label htmlFor="review-config">Configuration (JSON)</Label>
        <Textarea
          id="review-config"
          disabled={!isOwner}
          value={reviewConfig}
          onChange={(e) => setReviewConfig(e.target.value)}
          className="font-mono"
        />
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Signature policy</h2>
        <Textarea
          aria-label="Signature policy JSON"
          disabled={!isOwner}
          value={signaturePolicy}
          onChange={(e) => setSignaturePolicy(e.target.value)}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Electronic signatures are available. Meeting specific regulatory
          requirements requires validation of your full operational procedures,
          not just this feature.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Audit retention</h2>
        <Label htmlFor="retention-days">Retention period (days)</Label>
        <Input
          id="retention-days"
          type="number"
          min={1}
          disabled={!isOwner}
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Audit logs are retained for the specified period. Ensure your
          operational procedures align with applicable regulatory requirements.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Integration settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure SSO and lab equipment connections with JSON.
        </p>
        <Textarea
          aria-label="Integration settings JSON"
          disabled={!isOwner}
          value={integrations}
          onChange={(e) => setIntegrations(e.target.value)}
          className="font-mono"
        />
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {isOwner && (
        <Button disabled={saving || retention < 1} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      )}
    </div>
  )
}
