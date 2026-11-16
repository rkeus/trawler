import { ALLOW_ALL, parseRobots, type RobotsRules } from '../core';
import type { Fetcher } from './types';

/** Loads `<origin>/robots.txt`. Any failure (404, network) means everything is allowed. */
export async function loadRobots(fetcher: Fetcher, origin: string, agent: string): Promise<RobotsRules> {
  try {
    const res = await fetcher.fetch(`${origin}/robots.txt`);
    return parseRobots(res.body.toString('utf8'), agent);
  } catch {
    return ALLOW_ALL;
  }
}
