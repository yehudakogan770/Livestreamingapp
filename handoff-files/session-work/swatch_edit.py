import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/types.ts', [
("""  /** Shared text styles. */
  textStyles?: TextStyleDef[];""", """  /** Shared text styles. */
  textStyles?: TextStyleDef[];
  /** The title's own color swatches ("#rrggbb[aa]"). */
  swatches?: string[];"""),
])

edit('titler/src/designer/Designer.tsx', [
("""  const boxOf = (l: Layer) => layerBounds(lookOf(store.get()), l);""", """  // The color picker's swatches: the title's own, and the event look's colors.
  const swatches = useMemo<Swatches>(() => {
    const t = tokensFor(project, brand ?? undefined);
    return {
      list: project.swatches ?? [],
      add: (c) => store.edit('Add swatch', (p) => ({ ...p, swatches: [...(p.swatches ?? []).filter((x) => x !== c), c].slice(-40) })),
      remove: (c) => store.edit('Remove swatch', (p) => ({ ...p, swatches: (p.swatches ?? []).filter((x) => x !== c) })),
      brand: TOKEN_KEYS.filter((k) => !k.startsWith('font')).map((k) => [k, t[k]] as [string, string]),
    };
  }, [project, brand, store]);

  const boxOf = (l: Layer) => layerBounds(lookOf(store.get()), l);"""),
("""  return (
    <div
      className={`tt tt-look-${look}""", """  return (
    <SwatchContext.Provider value={swatches}>
    <div
      className={`tt tt-look-${look}"""),
("""      {renderOpen && <RenderDialog store={store} host={host} env={env} onClose={() => setRenderOpen(false)} />}
    </div>
  );
}""", """      {renderOpen && <RenderDialog store={store} host={host} env={env} onClose={() => setRenderOpen(false)} />}
    </div>
    </SwatchContext.Provider>
  );
}"""),
("import { tokensFor } from '../core/binding';", "import { TOKEN_KEYS, tokensFor } from '../core/binding';"),
("import { Mark } from './Mark';", "import { Mark } from './Mark';\nimport { SwatchContext, type Swatches } from './ColorPicker';"),
])
s = open('titler/src/designer/designer.css').read()
s += '''
/* The color picker (a swatch button opens it). */
.tt-color {
  position: relative;
}
.tt-color-swatch {
  width: 26px;
  height: 22px;
  padding: 2px;
  border: 1px solid var(--tt-line-2);
  border-radius: 3px;
  background: repeating-conic-gradient(#3a3a37 0 25%, #262624 0 50%) 0 0 / 8px 8px;
}
.tt-color-swatch i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 2px;
}
.tt-color-pop {
  position: absolute;
  z-index: 40;
  top: 26px;
  left: 0;
}
.tt-cpk {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 232px;
  padding: 10px;
  background: var(--tt-raised);
  border: 1px solid var(--tt-line-2);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.tt-cpk-sv {
  position: relative;
  height: 140px;
  border-radius: 3px;
  cursor: crosshair;
  touch-action: none;
}
.tt-cpk-hue,
.tt-cpk-alpha {
  position: relative;
  height: 12px;
  border-radius: 6px;
  cursor: ew-resize;
  touch-action: none;
}
.tt-cpk-hue {
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
.tt-cpk-alpha {
  background-color: #2a2a28;
}
.tt-cpk-sv i,
.tt-cpk-hue i,
.tt-cpk-alpha i {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.tt-cpk-hue i,
.tt-cpk-alpha i {
  top: 6px;
}
.tt-cpk-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tt-cpk-num {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--tt-dim);
}
.tt-cpk-num input {
  width: 100%;
  min-width: 0;
  padding: 2px 4px;
  font: 11px var(--tt-mono);
  color: var(--tt-text);
  background: var(--tt-field, #0f0f0e);
  border: 1px solid var(--tt-line-2);
  border-radius: 3px;
}
.tt-cpk-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.tt-cpk-sw {
  width: 18px;
  height: 18px;
  border: 1px solid var(--tt-line-2);
  border-radius: 3px;
}
.tt-cpk-sw.brand {
  border-radius: 50%;
}
.tt-cpk-gap {
  width: 6px;
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
