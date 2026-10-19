import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

for p in ['titler/src/core/render.ts', 'titler/src/core/layout.ts']:
    s = open(p).read()
    s = s.replace('"Inter", "Segoe UI", system-ui, sans-serif`', '"Inter", "Inter Variable", "Segoe UI", system-ui, sans-serif`')
    open(p, 'w').write(s)

edit('titler/src/designer/fields.tsx', [
("""  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);""", """  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  /** Where the picker opens: under the swatch, kept inside the window. */
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 254;
    const H = 330;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    return { left: Math.max(8, Math.min(r.left, vw - W - 8)), top: r.bottom + 4 + H > vh ? Math.max(8, r.top - H - 4) : r.bottom + 4 };
  };"""),
("""        aria-expanded={open}
        title="Open the color picker"
        onClick={() => setOpen(!open)}
      >""", """        aria-expanded={!!open}
        title="Open the color picker"
        onClick={(e) => setOpen(open ? null : place(e.currentTarget))}
      >"""),
("""      {open && (
        <span className="tt-color-pop">""", """      {open && (
        <span className="tt-color-pop" style={{ left: open.left, top: open.top }}>"""),
("""    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);""", """    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);"""),
])
edit('titler/src/designer/FontPicker.tsx', [
("""style={{ fontFamily: `"${shown(value)}"` }}>""", """style={{ fontFamily: `"${shown(value)}", "Inter Variable", system-ui, sans-serif` }}>"""),
("""                    style={{ fontFamily: `"${shown(f)}", system-ui` }}""", """                    style={{ fontFamily: `"${shown(f)}", "Inter Variable", system-ui, sans-serif` }}"""),
])
s = open('titler/src/designer/designer.css').read()
s = s.replace(""".tt-color-pop {
  position: absolute;
  z-index: 40;
  top: 26px;
  left: 0;
}""", """.tt-color-pop {
  position: fixed;
  z-index: 60;
}""")
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
