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
}, 15000);

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: SIZE, height: SIZE, useContentSize: true, frame: false, transparent: true, show: true, skipTaskbar: true });
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the first frame paint
  let image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== SIZE || size.height !== SIZE) {
    // only if the capture still is not SIZE x SIZE (display scaling): bring it there
    process.stderr.write(`capture is ${size.width}x${size.height}; resizing to ${SIZE}x${SIZE}\n`);
    image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
  }
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.toPNG());
  app.exit(0);
}).catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  app.exit(1);
});
