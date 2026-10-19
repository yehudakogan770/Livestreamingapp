import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/fields.tsx', [
("""  const shown = resolveColor(value, tokens, values, '#000000');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const swatch = isHex(shown) && shown.length === 7 ? shown : shown.slice(0, 7);
  return (
    <span className="tt-color">
      <input type="color" aria-label={`${label} color`} value={isHex(swatch) ? swatch : '#000000'} onChange={(e) => onChange(e.target.value)} />""", """  const shown = resolveColor(value, tokens, values, '#000000');
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <span className="tt-color" ref={wrap}>
      <button
        type="button"
        className="tt-color-swatch"
        aria-label={`${label} color`}
        aria-expanded={open}
        title="Open the color picker"
        onClick={() => setOpen(!open)}
      >
        <i style={{ background: isHex(shown) ? shown : '#000000' }} />
      </button>
      {open && (
        <span className="tt-color-pop">
          <ColorPicker value={isHex(shown) ? shown : '#000000'} onChange={onChange} onPick={onChange} label={label} />
        </span>
      )}"""),
("import { evalMath } from './math';", "import { evalMath } from './math';\nimport { ColorPicker } from './ColorPicker';"),
])
print('ok')
