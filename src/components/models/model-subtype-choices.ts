import { BUILT_IN_MODELS, builtInModel } from '#/lib/built-in-models'
import { typeAncestors, typeDescendants } from '#/lib/model-subtypes'
import type { ModelType } from '#/lib/model-subtypes'

/** A model's name from its key: a built-in model or a workspace type. */
export function modelName(types: readonly ModelType[], key: string): string {
  return (
    builtInModel(key)?.name ??
    types.find((type) => type.key === key)?.name ??
    key
  )
}

/** A key the database accepts, from the name the scientist typed. */
export function subtypeKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const key = /^[a-z]/.test(slug) ? slug : `type_${slug}`

  return key.slice(0, 60).replace(/_+$/, '') || 'type'
}

/** All potential parents except the model itself and its descendants. */
export function parentChoices(
  types: readonly ModelType[],
  key: string,
): { key: string; name: string }[] {
  const below = new Set(
    typeDescendants(types, key).map((option) => option.type.key),
  )

  return [
    ...BUILT_IN_MODELS.map((model) => ({ key: model.key, name: model.name })),
    ...types.flatMap((type) =>
      type.key !== key && !below.has(type.key)
        ? [
            {
              key: type.key,
              name: [...typeAncestors(types, type.key)]
                .reverse()
                .map((parent) => parent.name)
                .concat(type.name)
                .join(' › '),
            },
          ]
        : [],
    ),
  ]
}
