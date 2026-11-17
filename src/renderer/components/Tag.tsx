import type { Verdict } from '../../shared/types';

/** STATIC / HYBRID / JS badge. */
export function Tag({ kind }: { kind: Verdict }) {
  return <span className={`tag ${kind}`}>{kind === 'js' ? 'JS' : kind.toUpperCase()}</span>;
}
