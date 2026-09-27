import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { ReactNode } from 'react'

import { Banner, Notice } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Icon } from '#/components/icons'

/**
 * DSYS-03 states board. Lays out the primitive states the design's
 * `canvas/States.dc.html` shows (default, hover, focus, pressed, disabled,
 * invalid, selected) so it can be compared with `pnpm design:render States`
 * in both themes. Hover/focus states need pointer or keyboard interaction in
 * the Storybook canvas; the static default, pressed, disabled and invalid
 * states are visible here.
 */
const meta = {
  title: 'UI/States',
  component: Button,
  tags: ['autodocs'],
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-4 border-b py-3">
      <p className="text-caption text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export const Board: Story = {
  render: () => (
    <div className="max-w-3xl">
      <Row label="Buttons">
        <Button variant="primary">Submit for review</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="quiet">Dismiss</Button>
        <Button variant="danger">Discard draft</Button>
        <Button variant="danger-fill">Delete</Button>
        <Button variant="primary" disabled>
          Start run
        </Button>
        <Button size="iconOnly" variant="quiet" aria-label="More actions">
          <Icon name="more" />
        </Button>
      </Row>
      <Row label="Button sizes">
        <Button size="sm" variant="secondary">
          Small
        </Button>
        <Button size="md" variant="secondary">
          Medium
        </Button>
        <Button size="lg" variant="secondary">
          Large
        </Button>
      </Row>
      <Row label="Status tones">
        <Badge variant="outline">Draft</Badge>
        <Badge variant="success">Available</Badge>
        <Badge variant="warning">Quarantined</Badge>
        <Badge variant="danger">Failed</Badge>
        <Badge variant="info">In review</Badge>
        <Badge variant="violet">Review</Badge>
      </Row>
      <Row label="Fields">
        <Field className="w-56">
          <FieldLabel htmlFor="states-name">Name</FieldLabel>
          <Input id="states-name" defaultValue="Harvest clarification" />
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="states-unit">Unit</FieldLabel>
          <Select id="states-unit" defaultValue="g/L">
            <option value="g/L">g/L</option>
            <option value="mOsm/kg">mOsm/kg</option>
          </Select>
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="states-bad">Invalid</FieldLabel>
          <Input id="states-bad" aria-invalid="true" defaultValue="abc" />
          <FieldError>Value must be a number.</FieldError>
        </Field>
      </Row>
      <Row label="Banners">
        <Banner tone="warn">Saved on this device, not yet synced.</Banner>
        <Banner tone="bad">
          Signed and locked. Start an amendment to edit.
        </Banner>
        <Banner tone="review">In review, round 2.</Banner>
      </Row>
      <Row label="Notices">
        <Notice tone="info">3 unsynced changes.</Notice>
        <Notice tone="warn">Calibration due 3 Oct.</Notice>
        <Notice tone="bad">2 columns have no units.</Notice>
      </Row>
    </div>
  ),
}
