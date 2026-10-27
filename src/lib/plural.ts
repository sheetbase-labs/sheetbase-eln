/** "1 dataset", "2 datasets": the count with its noun in the right number. */
export function countOf(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}
