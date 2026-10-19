import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

s = open('titler/src/designer/Inspector.tsx').read()
i = s.index('      <Row label="Font">')
j = s.index('      </Row>', i) + len('      </Row>')
s = s[:i] + """      <Row label="Font">
        <FontPicker
          value={st.font}
          onChange={(font) => style('Font', { font })}
          brand={{ font: tokens.font, fontSub: tokens.fontSub }}
          own={store
            .get()
            .project.assets.filter((a) => a.kind === 'font' && a.family)
            .map((a) => a.family!)}
        />
      </Row>""" + s[j:]
s = s.replace("import { applyTextStyle, differsFromStyle, newTextStyle, styleFromLayer } from './textStyles';", "import { applyTextStyle, differsFromStyle, newTextStyle, styleFromLayer } from './textStyles';\nimport { FontPicker } from './FontPicker';")
open('titler/src/designer/Inspector.tsx', 'w').write(s)

edit('titler/app/main.tsx', [
("""import '@fontsource-variable/jetbrains-mono/wght.css';""", """import '@fontsource-variable/jetbrains-mono/wght.css';
// The fonts the templates and the font picker offer (the same ones Lumora and Studio have).
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/great-vibes/400.css';"""),
])

s = open('titler/src/designer/designer.css').read()
s += '''
/* The font picker: each font in its own face. */
.tt-font {
  position: relative;
  flex: 1;
  min-width: 0;
}
.tt-font-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  font-size: 13px;
  color: var(--tt-text);
  background: var(--tt-field, #0f0f0e);
  border: 1px solid var(--tt-line-2);
  border-radius: 3px;
}
.tt-font-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tt-font-pop {
  position: absolute;
  z-index: 40;
  top: 28px;
  left: 0;
  right: 0;
  min-width: 240px;
  padding: 6px;
  background: var(--tt-raised);
  border: 1px solid var(--tt-line-2);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.tt-font-pop .tt-input {
  width: 100%;
}
.tt-font-list {
  max-height: 300px;
  overflow: auto;
  margin-top: 4px;
}
.tt-font-group {
  padding: 6px 6px 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--tt-dim);
}
.tt-font-item {
  display: block;
  width: 100%;
  padding: 4px 8px;
  font-size: 15px;
  text-align: left;
  border-radius: var(--tt-radius);
}
.tt-font-item:hover,
.tt-font-item.on {
  background: var(--tt-selected);
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
