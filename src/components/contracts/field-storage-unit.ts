import type { FieldQuantityDefinition } from '#/lib/field-definition'

/**
 * The unit a field stores values in, from its quantity metadata. A field with
 * no quantity, or one that names no unit, stores plain numbers.
 */
export function storageUnitOf(
  quantity: FieldQuantityDefinition | null | undefined,
): string | null {
  const unit = quantity?.storageUnit

  return unit !== undefined && unit !== '' ? unit : null
}
