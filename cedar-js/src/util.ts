
export const jsonify = (a: any) => JSON.stringify(a, (key, value) =>
  typeof value === 'bigint' // Labels are bigint, which JSON.stringify doesn't support
    ? value.toString()
    : value // return everything else unchanged
  , 2)

class Path {

}