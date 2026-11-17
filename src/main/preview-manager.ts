import path from 'node:path';
import { readManifest, startPreviewServer, type PreviewServer } from '../engine';
import type { PreviewInfo } from '../shared/ipc';

/** Serves one finished download at a time on 127.0.0.1 (spec section 4.9), under the base path from its manifest. */
export class PreviewManager {
  private server: PreviewServer | undefined;
  private info: PreviewInfo | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  current(): PreviewInfo | undefined {
    return this.info ? { ...this.info } : undefined;
  }

  start(outputDir: string): Promise<PreviewInfo> {
    return this.serial(async () => {
      const dir = path.resolve(outputDir);
      const manifest = await readManifest(dir);
      if (!manifest) throw new Error('This folder has no Trawler download (_trawler/manifest.json is missing).');
      await this.close();
      this.server = await startPreviewServer({ root: dir, basePath: manifest.basePath || '/' });
      this.info = { url: this.server.url, outputDir: dir };
      return { ...this.info };
    });
  }

  stop(): Promise<void> {
    return this.serial(() => this.close());
  }

  private async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.info = undefined;
    await server?.close();
  }

  /** start and stop never overlap */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
