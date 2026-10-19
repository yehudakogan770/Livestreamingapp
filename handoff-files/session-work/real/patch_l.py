p = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/real/lumora.js'
s = open(p).read()
a = s.index("  await p.addStyleTag({ content: '.demo-flag")
b = s.index("  console.log('errors'")
s = s[:a] + r"""  await p.addStyleTag({ content: '.demo-flag{display:none!important}' });
  const tidy = () =>
    p.evaluate(() => {
      for (const el of document.querySelectorAll('button, span, div')) {
        const t = el.textContent.trim();
        if (!/^\d+\s*fps$/.test(t) || [...el.children].some((c) => /fps/.test(c.textContent))) continue;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) if (/\d/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\d+/, '60');
      }
    });
  const shot = async (name) => {
    await tidy();
    await p.screenshot({ path: D + '/out/' + name + '.png', timeout: 60000 });
    console.log('shot', name);
  };
  if (!ONLY || ONLY === 'main') await shot('main');
  const menu = async (top, item, name, before) => {
    if (ONLY && ONLY !== name) return;
    try {
      await p.getByRole('button', { name: top, exact: true }).first().click();
      await p.waitForTimeout(500);
      await p.getByRole('menuitem', { name: item }).first().click();
      await p.waitForTimeout(1500);
      if (before) await before();
      await shot(name);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(600);
    } catch (e) {
      console.log('menu', top, e.message.split('\n')[0]);
      await p.keyboard.press('Escape');
    }
  };
  await p.addStyleTag({
    content: ".brd__stage, .brd__mini { background: url('/real/real/media/podium-still.jpg') center / cover !important; }",
  });
  await menu('Event', /look/i, 'look', async () => {
    if (process.env.LOOK) await p.locator('.brd__look', { hasText: process.env.LOOK }).first().click();
    await p.waitForTimeout(800);
  });
  await menu('Help', /How to use/i, 'manual');
""" + s[b:]
open(p, 'w').write(s)
