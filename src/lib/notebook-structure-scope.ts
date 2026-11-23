/**
 * Every change to the notebook's structure (insert, duplicate, delete, undo
 * delete, move) reads the structure version when it starts and is refused as
 * stale if another change moved it first. Mutations that share a scope run one
 * after another in the order they were made, each starting after the one
 * before has finished and updated the cache, so a quick Alt+ArrowUp then
 * Alt+Enter both land.
 */
export const NOTEBOOK_STRUCTURE_SCOPE = { id: 'notebook-structure' } as const
