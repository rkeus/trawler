import { app, BrowserWindow } from 'electron';
import { parseCliArgs } from './cli';
import { runCli } from './cli-runner';

const EXIT_USAGE = 64;

app.setName('Trawler');
const parsed = parseCliArgs(process.argv);

if (parsed.kind === 'error') {
  process.stderr.write(`${parsed.message}\n`);
  void app.whenReady().then(() => app.exit(EXIT_USAGE));
} else if (parsed.kind === 'cli') {
  app.disableHardwareAcceleration(); // headless runs need no GPU
  // hidden capture windows open and close all the time: never quit because of that
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(async () => {
    let code = 1;
    try {
      code = await runCli(parsed.args);
    } catch (err) {
      process.stderr.write(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    }
    app.exit(code);
  });
} else {
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    const win = new BrowserWindow({ width: 900, height: 600, title: 'Trawler' });
    const page =
      '<!doctype html><meta charset="utf-8"><title>Trawler</title>' +
      '<body style="font-family:system-ui;padding:2rem"><h1>Trawler</h1>' +
      '<p>The desktop interface arrives in Plan 3. Until then, use the command line:</p>' +
      '<pre>npm run build:main\nnpx electron . --trawler-cli --url &lt;url&gt; --out &lt;folder&gt;</pre></body>';
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });
}
