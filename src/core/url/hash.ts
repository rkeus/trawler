import { createHash } from 'node:crypto';

/** First `length` hex characters of the SHA-1 of `input`. */
export function shortHash(input: string, length: number): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}
