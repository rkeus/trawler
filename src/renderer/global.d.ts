/// <reference types="vite/client" />
import type { TrawlerBridge } from '../shared/ipc';

declare global {
  interface Window {
    /** exposed by the preload (src/preload/index.ts) */
    trawler: TrawlerBridge;
  }
}

export {};
