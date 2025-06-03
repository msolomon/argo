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

export function uint8ArrayToBase64(byteArray: Uint8Array): string {
  // Check for Node.js environment and Buffer availability
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    // Node.js: Use Buffer for efficiency
    return Buffer.from(byteArray).toString('base64');
  }
  // Check for browser environment and btoa availability
  else if (typeof btoa !== 'undefined') {
    // Browser: Convert Uint8Array to a binary string, then use btoa
    // 1. Convert Uint8Array to a string of characters where each char code is a byte value
    let binaryString = '';
    for (let i = 0; i < byteArray.byteLength; i++) {
      binaryString += String.fromCharCode(byteArray[i]);
    }
    // 2. Encode the binary string to Base64
    return btoa(binaryString);
  } else {
    // Fallback or error if no suitable environment is found
    throw new Error("Cannot convert Uint8Array to Base64: 'Buffer' (Node.js) or 'btoa' (browser) not available.");
  }
}