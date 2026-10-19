p = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/real/lumora.js'
s = open(p).read()
old_a = "      await p.locator('.titlebar__item', { hasText: new RegExp('^' + top + '$') }).first().click();"
new_a = """      await p.evaluate((top) => [...document.querySelectorAll('.titlebar__item')].find((b) => b.textContent.trim() === top)?.click(), top);"""
assert old_a in s
s = s.replace(old_a, new_a)
old_b = "      await p.getByRole('menuitem', { name: item }).first().click();"
new_b = """      await p.evaluate((src) => [...document.querySelectorAll('[role=menuitem]')].find((b) => new RegExp(src, 'i').test(b.textContent))?.click(), item.source);"""
assert old_b in s
s = s.replace(old_b, new_b)
old_c = "    if (process.env.LOOK) await p.locator('.brd__look', { hasText: process.env.LOOK }).first().click();"
new_c = "    if (process.env.LOOK) await p.evaluate((n) => [...document.querySelectorAll('.brd__look')].find((b) => b.textContent.includes(n))?.click(), process.env.LOOK);"
assert old_c in s
s = s.replace(old_c, new_c)
s = s.replace("p.setDefaultTimeout(8000);", "p.setDefaultTimeout(30000);")
s = s.replace("await p.screenshot({ path: D + '/out/fail.png' });", "await p.screenshot({ path: D + '/out/fail.png', timeout: 60000 });")
open(p, 'w').write(s)
