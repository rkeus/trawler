const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const root = path.resolve(__dirname, '..');

// one device pixel per CSS pixel, whatever the display scaling is
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
// never hang: a stuck page load or capture ends the script with an error
setTimeout(() => {
  process.stderr.write('icon rendering timed out\n');
  app.exit(1);
}, 30000);

/** 24-bit BMP (the only format NSIS wizard images accept) from Electron's top-down BGRA bitmap. */
function toBmp(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowBytes * height);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowBytes * height, 34);
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * rowBytes; // BMP rows run bottom-up
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      out[dst + x * 3] = bgra[src];
      out[dst + x * 3 + 1] = bgra[src + 1];
      out[dst + x * 3 + 2] = bgra[src + 2];
    }
  }
  return out;
}

/** Everything rendered from an SVG in build/: [svg, width, height, output file]. */
const JOBS = [
  ['icon.svg', SIZE, SIZE, 'icon.png'],
  ['installer-sidebar.svg', 164, 314, 'installer-sidebar.bmp'],
  ['installer-header.svg', 150, 57, 'installer-header.bmp'],
];

async function render(svgFile, width, height, outFile) {
  const svg = fs.readFileSync(path.join(root, 'build', svgFile), 'utf8');
  const win = new BrowserWindow({ width, height, useContentSize: true, frame: false, transparent: true, show: true, skipTaskbar: true });
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`;
  // a temp file instead of a data: URL: a second data: load in one run failed with ERR_FAILED
  const page = path.join(require('node:os').tmpdir(), `trawler-render-${process.pid}-${outFile}.html`);
  fs.writeFileSync(page, html);
  try {
    await win.loadFile(page);
  } finally {
    fs.rmSync(page, { force: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the first frame paint
  let image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== width || size.height !== height) {
    // only if the capture still is not the wanted size (display scaling): bring it there
    process.stderr.write(`${svgFile}: capture is ${size.width}x${size.height}; resizing to ${width}x${height}\n`);
    image = image.resize({ width, height, quality: 'best' });
  }
  fs.writeFileSync(path.join(root, 'build', outFile), outFile.endsWith('.bmp') ? toBmp(image) : image.toPNG());
}

app.whenReady().then(async () => {
  for (const job of JOBS) await render(...job);
  app.exit(0);
}).catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  app.exit(1);
});
