import { IResolvable, TokenizedStringFragments, isResolvableObject } from 'aws-cdk-lib';

// Details for encoding and decoding Tokens into native types; should not be exported

export const BEGIN_STRING_TOKEN_MARKER = '${Token[';
export const BEGIN_LIST_TOKEN_MARKER = '#{Token[';
export const END_TOKEN_MARKER = ']}';

export const VALID_KEY_CHARS = 'a-zA-Z0-9:._-';

const QUOTED_BEGIN_STRING_TOKEN_MARKER = regexQuote(BEGIN_STRING_TOKEN_MARKER);
const QUOTED_BEGIN_LIST_TOKEN_MARKER = regexQuote(BEGIN_LIST_TOKEN_MARKER);
const QUOTED_END_TOKEN_MARKER = regexQuote(END_TOKEN_MARKER);

const STRING_TOKEN_REGEX = new RegExp(`${QUOTED_BEGIN_STRING_TOKEN_MARKER}([${VALID_KEY_CHARS}]+)${QUOTED_END_TOKEN_MARKER}`, 'g');
const LIST_TOKEN_REGEX = new RegExp(`${QUOTED_BEGIN_LIST_TOKEN_MARKER}([${VALID_KEY_CHARS}]+)${QUOTED_END_TOKEN_MARKER}`, 'g');

/**
 * A string with markers in it that can be resolved to external values
 */
export class TokenString {
    /**
     * Returns a `TokenString` for this string.
     */
    public static forString(s: string) {
        return new TokenString(s, STRING_TOKEN_REGEX);
    }

    /**
     * Returns a `TokenString` for this string (must be the first string element of the list)
     */
    public static forListToken(s: string) {
        return new TokenString(s, LIST_TOKEN_REGEX);
    }

    /* eslint-disable no-useless-constructor */
    constructor(private readonly str: string, private readonly re: RegExp) {
    }
    /* eslint-enable no-useless-constructor */

    /**
     * Split string on markers, substituting markers with Tokens
     */
    public split(lookup: (id: string) => IResolvable): TokenizedStringFragments {
        const ret = new TokenizedStringFragments();

        let rest = 0;
        this.re.lastIndex = 0; // Reset
        let m = this.re.exec(this.str);
        while (m) {
            if (m.index > rest) {
                ret.addLiteral(this.str.substring(rest, m.index));
            }

            ret.addToken(lookup(m[1]));

            rest = this.re.lastIndex;
            m = this.re.exec(this.str);
        }

        if (rest < this.str.length) {
            ret.addLiteral(this.str.substring(rest));
        }

        return ret;
    }

    /**
     * Indicates if this string includes tokens.
     */
    public test(): boolean {
        this.re.lastIndex = 0; // Reset
        return this.re.test(this.str);
    }
}

/**
 * Quote a string for use in a regex
 */
export function regexQuote(s: string) {
    return s.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&');
}

/**
 * Returns true if obj is a token (i.e. has the resolve() method or is a string
 * that includes token markers), or it's a listifictaion of a Token string.
 *
 * @param obj The object to test.
 */
export function unresolved(obj: any): boolean {
    if ('string' === typeof(obj)) {
        return TokenString.forString(obj).test();
    } else if ('number' === typeof obj) {
        return extractTokenDouble(obj) !== undefined;
    } else if (Array.isArray(obj) && 1 === obj.length) {
        return 'string' === typeof(obj[0]) && TokenString.forListToken(obj[0]).test();
    }
    return isResolvableObject(obj);

}

/**
 * Bit pattern in the top 16 bits of a double to indicate a Token
 *
 * An IEEE double in LE memory order looks like this (grouped
 * into octets, then grouped into 32-bit words):
 *
 * mmmmmmmm.mmmmmmmm.mmmmmmmm.mmmmmmmm | mmmmmmmm.mmmmmmmm.EEEEmmmm.sEEEEEEE
 *
 * - m: mantissa (52 bits)
 * - E: exponent (11 bits)
 * - s: sign (1 bit)
 *
 * We put the following marker into the top 16 bits (exponent and sign), and
 * use the mantissa part to encode the token index. To save some bit twiddling
 * we use all top 16 bits for the tag. That loses us 4 mantissa bits to store
 * information in but we still have 48, which is going to be plenty for any
 * number of tokens to be created during the lifetime of any CDK application.
 *
 * Can't have all bits set because that makes a NaN, so unset the least
 * significant exponent bit.
 *
 * Currently not supporting BE architectures.
 */
// eslint-disable-next-line no-bitwise
const DOUBLE_TOKEN_MARKER_BITS = 0xFBFF << 16;

/**
 * Get 2^32 as a number, so we can do multiplication and div instead of bit shifting
 *
 * Necessary because in JavaScript, bit operations implicitly convert
 * to int32 and we need them to work on "int64"s.
 *
 * So instead of x >> 32, we do Math.floor(x / 2^32), and vice versa.
 */
const BITS32 = Math.pow(2, 32);

/**
 * Shift a 64-bit left 32 bits
 */
function shl32(x: number) {
    return x * BITS32;
}

/**
 * Extract the encoded integer out of the special Double value
 *
 * Returns undefined if the float is a not an encoded token.
 */
export function extractTokenDouble(encoded: number): number | undefined {
    const buf = new ArrayBuffer(8);
    (new Float64Array(buf))[0] = encoded;

    const ints = new Uint32Array(buf);

    /* eslint-disable no-bitwise */
    if ((ints[1] & 0xFFFF0000) !== DOUBLE_TOKEN_MARKER_BITS) {
        return undefined;
    }

    // Must use + instead of | here (bitwise operations
    // Will force 32-bits integer arithmetic, + will not).
    return ints[0] + shl32(ints[1] & 0xFFFF);
    /* eslint-enable no-bitwise */
}
