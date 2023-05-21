// Utility functions

/** As JSON.stringify, but handle bigints and apply pleasant defaults */
export const jsonify = (a: any) => JSON.stringify(a, (key, value) =>
  typeof value === 'bigint' // Labels are bigint, which JSON.stringify doesn't support
    ? value.toString()
    : value // return everything else unchanged
  , 2)


/** Groups values by a key extracted from each value */
export function groupBy<T, K>(array: T[], extract: (t: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const element of array) {
    const key = extract(element)
    const group = grouped.get(key)
    if (group == undefined) grouped.set(key, [element])
    else group.push(element)
  }
  return grouped
}