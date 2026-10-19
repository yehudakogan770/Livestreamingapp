const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args: ['--ignore-certificate-errors'] });
  const p = await b.newPage();
  const r = await p.evaluate(() => new Promise((res) => {
    const out = []; const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws.onopen = () => { ws.send('CAP REQ :twitch.tv/tags'); ws.send('PASS SCHMOOPIIE'); ws.send('NICK justinfan54321'); ws.send('JOIN #twitch'); };
    ws.onmessage = (e) => { out.push(String(e.data).slice(0, 120)); if (out.length > 6) res(out); };
    ws.onerror = () => res(['error', ...out]);
    setTimeout(() => res(['timeout', ...out]), 8000);
  }));
  console.log(r.join('\n'));
  await b.close();
})();
