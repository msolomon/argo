/** As JSON.stringify, but handle bigints and apply pleasant defaults */
export declare const jsonify: (a: any) => string;
/** Groups values by a key extracted from each value */
export declare function groupBy<T, K>(array: T[], extract: (t: T) => K): Map<K, T[]>;
