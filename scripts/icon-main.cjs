const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const root = path.resolve(__dirname, '..');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: SIZE, height: SIZE, useContentSize: true, frame: false, transparent: true, show: true, skipTaskbar: true });
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((resolve) => setTimeout(resolve, 500)); // let the first frame paint
  const image = await win.webContents.capturePage();
  // on a scaled display the capture has more pixels than the window: bring it to exactly SIZE x SIZE
  const out = image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), out);
  app.exit(0);
}).catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  app.exit(1);
});
