/**
 * Gets a value or throws an exception.
 *
 * @param value A value, possibly undefined
 * @param err The error to throw if `value` is undefined.
 */
export function valueOrDie<T, C extends T = T>(
    value: T | undefined,
    err: Error,
): C {
    if (value === undefined) {
        throw err;
    }

    return value as C;
}
