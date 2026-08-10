import type { ReactNode } from 'react'

import {
  ActivityFeed,
  EmptyHint,
  FileList,
  Inspector,
  InspectorSection,
  InspectorSectionStack,
  LinkedRecordList,
  Property,
  PropertyList,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { Badge } from '#/components/ui'
import { formatDate } from '#/lib/notebook-data'
import { MOVEMENT_LABELS, reagentAttention } from '#/lib/reagent-data'
import type {
  Reagent,
  ReagentMovement,
  ReagentUsageLink,
} from '#/lib/reagent-data'

export interface ReagentInspectorProps {
  reagent: Reagent
  movements: ReagentMovement[]
  usage: ReagentUsageLink[]
  actions?: ReactNode
  onClose?: () => void
}

function quantityLabel(reagent: Reagent): string {
  if (reagent.quantity === null) return '—'
  return `${reagent.quantity}${reagent.unit ? ` ${reagent.unit}` : ''}`
}

function movementDescription(movement: ReagentMovement): string {
  const delta = `${movement.quantityDelta > 0 ? '+' : ''}${movement.quantityDelta}`
  const unit = movement.unit ? ` ${movement.unit}` : ''
  return `${delta}${unit}; ${movement.resultingQuantity}${unit} in stock`
}

export function ReagentInspector({
  reagent,
  movements,
  usage,
  actions,
  onClose,
}: ReagentInspectorProps) {
  const attention = reagentAttention(reagent)
  const recentOrders = movements.filter(
    (movement) => movement.operation === 'receive',
  )

  return (
    <Inspector
      recordType="Reagent"
      title={reagent.identifier}
      status={<StatusBadge domain="reagent" status={reagent.status} />}
      onClose={onClose}
      tabs={[
        {
          id: 'details',
          label: 'Details',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Reagent overview">
                <PropertyList>
                  <Property label="Name" stacked>
                    {reagent.title}
                  </Property>
                  <Property label="Category">{reagent.category}</Property>
                  <Property label="Quantity" mono>
                    {quantityLabel(reagent)}
                  </Property>
                  <Property label="Storage">{reagent.storage ?? '—'}</Property>
                  <Property label="Expiry">
                    {reagent.expiry ? formatDate(reagent.expiry) : '—'}
                  </Property>
                  <Property label="Stock attention">
                    {attention.kind === 'ok'
                      ? 'None'
                      : attention.kind.replace('_', ' ')}
                  </Property>
                  <Property label="Last updated">
                    {formatDate(reagent.updatedAt)}
                  </Property>
                </PropertyList>
              </InspectorSection>

              <InspectorSection title="Supplier details">
                <PropertyList>
                  <Property label="Supplier">
                    {reagent.supplier ?? '—'}
                  </Property>
                  <Property label="Catalog No." mono>
                    {reagent.catalogNo ?? '—'}
                  </Property>
                  <Property label="Lot" mono>
                    {reagent.lot ?? '—'}
                  </Property>
                  <Property label="Low-stock threshold" mono>
                    {reagent.lowStockThreshold === null
                      ? '—'
                      : `${reagent.lowStockThreshold}${reagent.unit ? ` ${reagent.unit}` : ''}`}
                  </Property>
                </PropertyList>
              </InspectorSection>

              <InspectorSection title="Certificates & documents">
                <FileList items={[]} />
              </InspectorSection>

              <InspectorSection title="Usage history">
                <LinkedRecordList
                  items={usage.map((link) => ({
                    id: link.id,
                    type: link.sourceKind,
                    title: link.sourceIdentifier,
                    meta: link.linkType,
                  }))}
                />
              </InspectorSection>

              <InspectorSection title="Recent orders">
                {recentOrders.length === 0 ? (
                  <EmptyHint>No recent stock receipts</EmptyHint>
                ) : (
                  <ul className="space-y-1.5">
                    {recentOrders.slice(0, 5).map((order) => (
                      <li
                        key={order.id}
                        className="rounded-md border border-border px-2 py-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {order.supplier ?? 'Stock receipt'}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDate(order.createdAt)}
                          </span>
                        </div>
                        <p className="text-muted-foreground">
                          {movementDescription(order)}
                          {order.lot ? ` · Lot ${order.lot}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </InspectorSection>

              {reagent.tags.length > 0 ? (
                <InspectorSection title="Tags">
                  <div className="flex flex-wrap gap-1">
                    {reagent.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </InspectorSection>
              ) : null}

              {actions ? (
                <InspectorSection title="Actions">{actions}</InspectorSection>
              ) : null}
            </InspectorSectionStack>
          ),
        },
        {
          id: 'activity',
          label: 'Activity',
          badge: movements.length,
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Stock activity">
                <ActivityFeed
                  items={movements.map((movement) => ({
                    id: movement.id,
                    actor: { name: 'Inventory' },
                    action: MOVEMENT_LABELS[movement.operation].toLowerCase(),
                    target: movementDescription(movement),
                    at: formatDate(movement.createdAt),
                  }))}
                />
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'comments',
          label: 'Comments',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Comments">
                <EmptyHint>No comments yet</EmptyHint>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
      ]}
    />
  )
}
