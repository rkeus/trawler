import { describe, it, expect } from 'vitest';
import { extractHtmlRefs } from '../../../../src/core/html/extract';
import { walkHtml } from '../../../../src/core/html/walk-html';

const PAGE = 'https://x.com/html/index.html';
const B = 'https://x.com/html/';

const FIXTURE = `<!doctype html>
<html><head>
<link rel="stylesheet" href="assets/css/style.css">
<link rel="icon" href="assets/img/favicon.png">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="canonical" href="https://x.com/html/index.html">
<meta property="og:image" content="https://x.com/html/assets/img/og.jpg">
<style>.hero{background:url(assets/img/hero.jpg)}</style>
<script src="assets/js/app.js"></script>
</head><body>
<a href="about.html">About</a><a href="#top">Top</a><a href="mailto:a@b.c">Mail</a>
<img src="assets/img/a.png" srcset="assets/img/a@2x.png 2x">
<div data-bg="assets/img/lazy-bg.jpg" style="background-image:url('assets/img/inline.jpg')"></div>
<img data-src="assets/img/lazy.jpg" data-lazy="true">
<picture><source srcset="assets/img/p.webp" type="image/webp"></picture>
<video poster="assets/img/poster.jpg"><source src="assets/media/v.mp4"></video>
<svg><use href="assets/img/sprite.svg#icon"></use><use xlink:href="assets/img/sprite2.svg#i"></use></svg>
<noscript><img src="assets/img/noscript.png"></noscript>
<template><img src="assets/img/tpl.png"></template>
<iframe src="embed.html"></iframe>
</body></html>`;

describe('extractHtmlRefs', () => {
  const { assets, pages } = extractHtmlRefs(FIXTURE, PAGE);

  it('finds every asset source', () => {
    expect(assets.map((a) => a.url).sort()).toEqual(
      [
        'assets/css/style.css',
        'assets/img/favicon.png',
        'assets/img/og.jpg',
        'assets/img/hero.jpg',
        'assets/js/app.js',
        'assets/img/a.png',
        'assets/img/a@2x.png',
        'assets/img/lazy-bg.jpg',
        'assets/img/inline.jpg',
        'assets/img/lazy.jpg',
        'assets/img/p.webp',
        'assets/img/poster.jpg',
        'assets/media/v.mp4',
        'assets/img/sprite.svg',
        'assets/img/sprite2.svg',
        'assets/img/noscript.png',
        'assets/img/tpl.png',
      ]
        .map((p) => B + p)
        .sort(),
    );
  });

  it('assigns kinds', () => {
    const kind = (p: string) => assets.find((a) => a.url === B + p)?.kind;
    expect(kind('assets/css/style.css')).toBe('css');
    expect(kind('assets/js/app.js')).toBe('js');
    expect(kind('assets/media/v.mp4')).toBe('media');
    expect(kind('assets/img/hero.jpg')).toBe('image');
  });

  it('finds page links but not fragments, mailto, canonical or preconnect', () => {
    expect(pages.map((p) => p.url).sort()).toEqual([B + 'about.html', B + 'embed.html']);
  });

  it('honors <base href>', () => {
    const html = '<head><base href="https://cdn.x.com/site/"></head><body><img src="a.png"></body>';
    expect(extractHtmlRefs(html, 'https://x.com/p/index.html').assets.map((a) => a.url)).toEqual([
      'https://cdn.x.com/site/a.png',
    ]);
  });

  it('ignores non-URL lazy attribute values', () => {
    const html = '<div data-bg="rgba(0,0,0,.5)" data-lazy="1.5" data-image="true" data-src="img/x.jpg"></div>';
    expect(extractHtmlRefs(html, PAGE).assets.map((a) => a.url)).toEqual([B + 'img/x.jpg']);
  });

  it('uses only the first <base href>', () => {
    const html = '<head><base href="/one/"><base href="/two/"></head><body><img src="a.png"></body>';
    expect(extractHtmlRefs(html, PAGE).assets.map((a) => a.url)).toEqual(['https://x.com/one/a.png']);
  });

  it('does not duplicate refs from reconstructed formatting elements', () => {
    const { pages } = extractHtmlRefs('<p><a href="about.html">About</p><p>next</p>', PAGE);
    expect(pages.map((p) => p.url)).toEqual([B + 'about.html']);
  });
});

describe('walkHtml', () => {
  it('returns the input byte-identical when nothing changes', () => {
    expect(walkHtml(FIXTURE, () => undefined)).toBe(FIXTURE);
  });
});
