import * as crypto from 'crypto';
import { unresolved } from './encoding';

/**
 * Resources with this ID are hidden from humans
 *
 * They do not appear in the human-readable part of the logical ID,
 * but they are included in the hash calculation.
 */
const HIDDEN_FROM_HUMAN_ID = 'Resource';

/**
 * Resources with this ID are complete hidden from the logical ID calculation.
 */
const HIDDEN_ID = 'Default';

const PATH_SEP = '/';

const HASH_LEN = 8;
const MAX_HUMAN_LEN = 240; // Max ID len is 255
const MAX_ID_LEN = 255;

/**
 * Calculates a unique ID for a set of textual components.
 *
 * This is done by calculating a hash on the full path and using it as a suffix
 * of a length-limited "human" rendition of the path components.
 *
 * @param components The path components
 * @returns a unique alpha-numeric identifier with a maximum length of 255
 */
export function makeUniqueId(components: string[]) {
    components = components.filter(x => x !== HIDDEN_ID);

    if (0 === components.length) {
        throw new Error('Unable to calculate a unique id for an empty set of components');
    }

    // Lazy require in order to break a module dependency cycle
    const unresolvedTokens = components.filter(c => unresolved(c));
    if (0 < unresolvedTokens.length) {
        throw new Error(`ID components may not include unresolved tokens: ${unresolvedTokens.join(',')}`);
    }

    // Top-level resources will simply use the `name` as-is in order to support
    // Transparent migration of cloudformation templates to the CDK without the
    // Need to rename all resources.
    if (1 === components.length) {
        // We filter out non-alpha characters but that is actually a bad idea
        // Because it could create conflicts ("A-B" and "AB" will render the same
        // Logical ID). sadly, changing it in the 1.x version line is impossible
        // Because it will be a breaking change. we should consider for v2.0.
        // https://github.com/aws/aws-cdk/issues/6421
        const candidate = removeNonAlphanumeric(components[0]);

        // If our candidate is short enough, use it as is. otherwise, fall back to
        // The normal mode.
        if (candidate.length <= MAX_ID_LEN) {
            return candidate;
        }
    }

    const hash = pathHash(components);
    const human = removeDupes(components)
        .filter(x => x !== HIDDEN_FROM_HUMAN_ID)
        .map(removeNonAlphanumeric)
        .join('')
        .slice(0, MAX_HUMAN_LEN);

    return human + hash;
}

/**
 * Take a hash of the given path.
 *
 * The hash is limited in size.
 */
function pathHash(path: string[]): string {
    const md5 = crypto.createHash('md5').update(path.join(PATH_SEP)).digest('hex');
    return md5.slice(0, HASH_LEN).toUpperCase();
}

/**
 * Removes all non-alphanumeric characters in a string.
 */
function removeNonAlphanumeric(s: string) {
    return s.replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Remove duplicate "terms" from the path list
 *
 * If the previous path component name ends with this component name, skip the
 * current component.
 */
function removeDupes(path: string[]): string[] {
    const ret = new Array<string>();

    for (const component of path) {
        if (0 === ret.length || !ret[ret.length - 1].endsWith(component)) {
            ret.push(component);
        }
    }

    return ret;
}
