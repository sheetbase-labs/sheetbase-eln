import type { ObjectDependency } from '#/lib/object-dependencies'

/** A dataset's own snapshot versions are not external users. */
export function datasetUsers(
  dependencies: ObjectDependency[],
): ObjectDependency[] {
  return dependencies.filter(
    (dependency) => dependency.kind !== 'dataset_version',
  )
}
