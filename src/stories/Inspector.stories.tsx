import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Inspector } from '#/components/record/inspector'
import type { InspectorTab } from '#/components/record/inspector'
import {
  ActivityFeed,
  CheckList,
  ContributorAvatars,
  FileList,
  InspectorSection,
  InspectorSectionStack,
  LinkedRecordList,
  TagPills,
} from '#/components/record/inspector-sections'
import { Property, PropertyList } from '#/components/scientific/property-list'
import { StatusBadge } from '#/components/scientific/status-badge'

/**
 * The contextual inspector is a content container: routes pass typed tab
 * content, so these stories pass fixture sections rather than mocked data.
 * It fills the height its surface gives it, hence the sized frame.
 */
const tabs: InspectorTab[] = [
  {
    id: 'properties',
    label: 'Properties',
    content: (
      <InspectorSectionStack>
        <InspectorSection title="Identifiers">
          <PropertyList>
            <Property label="ID">EXP-2026-0042</Property>
            <Property label="Protocol">PRT-2026-0012</Property>
          </PropertyList>
        </InspectorSection>
        <InspectorSection title="Contributors">
          <ContributorAvatars
            contributors={[
              { id: 'u1', name: 'Ava Chen' },
              { id: 'u2', name: 'Marco Silva' },
              { id: 'u3', name: 'Priya Raman' },
              { id: 'u4', name: 'Tom Ellis' },
              { id: 'u5', name: 'Sara Ndiaye' },
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Tags">
          <TagPills tags={['stability', 'lentivector', '4 °C']} />
        </InspectorSection>
      </InspectorSectionStack>
    ),
  },
  {
    id: 'linked',
    label: 'Linked',
    badge: 3,
    content: (
      <LinkedRecordList
        items={[
          {
            id: 'l1',
            type: 'Sample',
            title: 'LVV-CAR-T drug substance',
            meta: 'SMP-2026-0142',
            href: '/samples/1',
            icon: 'tube',
          },
          {
            id: 'l2',
            type: 'Protocol',
            title: 'Titration assay',
            meta: 'PRT-2026-0012',
            icon: 'protocol',
          },
        ]}
      />
    ),
  },
  {
    id: 'files',
    label: 'Files',
    content: (
      <FileList
        items={[
          {
            id: 'f1',
            name: 'qPCR-plate-1.csv',
            size: '18.4 kB',
            mediaType: 'text/csv',
            href: '/files/1',
          },
          {
            id: 'f2',
            name: 'Instrument report.pdf',
            size: '1.2 MB',
            mediaType: 'application/pdf',
          },
        ]}
      />
    ),
  },
  {
    id: 'checks',
    label: 'Checks',
    badge: '1 fail',
    content: (
      <CheckList
        items={[
          { id: 'c1', label: 'Units are canonical', state: 'pass' },
          {
            id: 'c2',
            label: 'All samples resolve',
            state: 'fail',
            detail: '1 of 8',
          },
          { id: 'c3', label: 'Signature current', state: 'pending' },
          { id: 'c4', label: 'Control within range', state: 'warning' },
        ]}
      />
    ),
  },
  {
    id: 'activity',
    label: 'Activity',
    content: (
      <ActivityFeed
        items={[
          {
            id: 'a1',
            actor: { name: 'Ava Chen' },
            action: 'submitted',
            target: 'EXP-2026-0042',
            at: '29 Jul 2026, 14:03',
          },
          {
            id: 'a2',
            actor: { name: 'Marco Silva', initials: 'MS' },
            action: 'uploaded',
            target: 'qPCR-plate-1.csv',
            at: '29 Jul 2026, 11:48',
          },
        ]}
      />
    ),
  },
]

const meta = {
  title: 'Record/Inspector',
  component: Inspector,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="h-[620px] w-[360px] overflow-hidden rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    recordType: 'Experiment',
    title: 'Virus stability at 4 °C',
    status: <StatusBadge domain="experiment" status="in-progress" />,
    tabs,
    onClose: () => {},
  },
} satisfies Meta<typeof Inspector>
export default meta
type Story = StoryObj<typeof meta>

/** Loaded experiment with five tabs; the identity header stays pinned. */
export const Default: Story = {}

/** No selection: the panel states it rather than showing empty tabs. */
export const NoSelection: Story = { args: { state: 'no-selection' } }

export const Skeleton: Story = { args: { state: 'skeleton' } }

export const Unavailable: Story = { args: { state: 'unavailable' } }

export const PermissionDenied: Story = {
  args: { state: 'permission-denied' },
}

/** A tab with a badge suffix and no status slot. */
export const CountBadges: Story = {
  args: {
    tabs: tabs.map((tab) =>
      tab.id === 'files'
        ? { ...tab, badge: 12, label: 'Files' }
        : tab.id === 'activity'
          ? { ...tab, label: 'Comment' }
          : tab,
    ),
    status: undefined,
  },
}

/** A different tab opens first when `defaultTab` names it. */
export const DefaultTab: Story = {
  args: { defaultTab: 'checks' },
}

/** The notebook inspector skips the header: the title sits above the canvas. */
export const Headerless: Story = {
  args: { hideHeader: true, tabs: tabs.slice(0, 2) },
}

/** No tabs at all — the panel shows only its header. */
export const NoTabs: Story = { args: { tabs: [] } }
