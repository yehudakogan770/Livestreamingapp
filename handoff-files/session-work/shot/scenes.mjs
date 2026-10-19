const menu = async (p, top, item) => {
  await p.locator('.ed__menu', { hasText: top }).first().click();
  await p.waitForTimeout(200);
  if (item) await p.locator('.pop').getByText(item, { exact: false }).first().click();
  await p.waitForTimeout(500);
};
const selClip = async (p, n = 1) => {
  await p.locator('.clip').nth(n).click({ position: { x: 30, y: 8 } });
  await p.waitForTimeout(400);
};
const seek = async (p, x = 300) => {
  const r = await p.locator('.ruler').boundingBox();
  await p.mouse.click(r.x + x, r.y + 10);
  await p.waitForTimeout(500);
};
export default [
  { name: 'start', query: '?start' },
  {
    name: 'start-recent',
    query: '?start',
    run: async (p) => {
      await p.evaluate(() => {
        const now = Date.now();
        localStorage.setItem(
          'lumora-edit-recent',
          JSON.stringify([
            { path: 'C:/Users/You/Videos/Lumora/Spring Gala.lumoraedit', name: 'Spring Gala', at: now - 3600e3 },
            { path: 'C:/Users/You/Videos/Lumora/Board meeting 2026-09-14.lumora', name: 'Board meeting 2026-09-14', at: now - 86400e3 * 3 },
            { path: 'D:/Projects/Promo/Fall promo.lumoraedit', name: 'Fall promo', at: now - 86400e3 * 12 },
          ]),
        );
      });
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
    },
  },
  {
    name: 'edit',
    run: async (p) => {
      await seek(p, 260);
      await selClip(p, 1);
    },
  },
  { name: 'menu', run: async (p) => menu(p, 'Edit') },
  {
    name: 'marks',
    run: async (p) => {
      const r = await p.locator('.ruler').boundingBox();
      await p.mouse.click(r.x + 200, r.y + 10);
      await p.keyboard.press('i');
      await p.mouse.click(r.x + 520, r.y + 10);
      await p.keyboard.press('o');
      await p.keyboard.press('m');
      await p.mouse.click(r.x + 380, r.y + 10);
      await p.waitForTimeout(300);
    },
  },
  {
    name: 'color',
    run: async (p) => {
      await seek(p, 260);
      await selClip(p, 1);
      await p.locator('.ed__pages button', { hasText: 'Color' }).click();
      await p.waitForTimeout(600);
      await p.locator('.ngraph__bar button', { hasText: 'Serial' }).click();
      await p.waitForTimeout(200);
      await p.locator('.ngraph__bar button', { hasText: 'Parallel' }).click();
      await p.waitForTimeout(200);
      await p.locator('.ngraph__bar button', { hasText: 'Serial' }).click();
      await p.waitForTimeout(600);
    },
  },
  {
    name: 'audio',
    run: async (p) => {
      await seek(p, 260);
      await p.locator('.ed__pages button', { hasText: 'Audio' }).click();
    },
  },
  { name: 'smart-silence', run: async (p) => menu(p, 'Smart', 'Remove silences') },
  { name: 'smart-multicam', run: async (p) => menu(p, 'Smart', 'Auto multicam') },
  { name: 'smart-reframe', run: async (p) => menu(p, 'Smart', 'Auto reframe') },
  { name: 'ai-menu', run: async (p) => menu(p, 'AI') },
  { name: 'ai-colormatch', run: async (p) => menu(p, 'AI', 'Auto color match') },
  { name: 'ai-search', run: async (p) => menu(p, 'AI', 'Media search') },
  { name: 'ai-music', run: async (p) => menu(p, 'AI', 'Music') },
  { name: 'export', run: async (p) => p.locator('.ed__export').click() },
  { name: 'help', run: async (p) => menu(p, 'Help', 'Keyboard shortcuts') },
  { name: 'transcript', run: async (p) => p.locator('.tabs button', { hasText: 'Transcript' }).click() },
  { name: 'bins', run: async (p) => p.locator('.panel--project .tabs button').nth(1).click() },
  { name: 'text-tab', run: async (p) => p.locator('.panel--project .tabs button').nth(2).click() },
  {
    name: 'tracking',
    run: async (p) => {
      await seek(p, 260);
      await selClip(p, 1);
      const t = p.locator('.sect__fold', { hasText: 'Tracking' });
      await t.scrollIntoViewIfNeeded();
      await t.click();
      await p.waitForTimeout(200);
      await p.getByText('Track a region').first().click();
      await p.waitForTimeout(300);
    },
  },
  {
    name: 'graph',
    run: async (p) => {
      await seek(p, 260);
      await selClip(p, 1);
      // a keyframe on Scale, so the graph has something to show
      const w = p.locator('.prow', { hasText: 'Scale' }).locator('.prow__watch');
      await w.click();
      await p.waitForTimeout(200);
      const g = p.locator('.sect__fold', { hasText: 'Graph editor' });
      await g.scrollIntoViewIfNeeded();
      await g.click();
      await p.waitForTimeout(200);
      await g.scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
    },
  },
];
