import type { CaptureResult, Capturer } from '../../src/engine/types';

export type FakeRender = (url: string) => Partial<CaptureResult> & { html: string };

/** A Capturer that returns canned renders and records which URLs were rendered. */
export function fakeCapturer(render: FakeRender): Capturer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async capture(url: string): Promise<CaptureResult> {
      calls.push(url);
      const r = render(url);
      return {
        url,
        finalUrl: url,
        status: 200,
        renderedHtml: r.html,
        resources: [],
        dataRequests: 0,
        failed: [],
        ...r,
      };
    },
  };
}
