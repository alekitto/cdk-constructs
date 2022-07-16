export function flatten(x: string[][]) {
    return Array.prototype.concat([], ...x);
}
