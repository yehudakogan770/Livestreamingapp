import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Designer.tsx', [
("""const CLIP_MIME = 'application/x-lumora-titler-layers';
let clipboard: Layer[] | null = null;""", """const CLIP_MIME = 'application/x-lumora-titler-layers';
let clipboard: Layer[] | null = null;
/** Keyframes copied (pasted onto the selected layers at the playhead); the last copy wins. */
let keyClipboard: KeyClip | null = null;"""),
("""      copy() {
        const layers = store.selected();
        if (!layers.length) return;
        clipboard = cloneLayers(layers);""", """      copy() {
        const s = store.get();
        if (s.keys.length) {
          // Keyframes selected: copy those (from the first key's layer).
          const layer = findLayer(compOf(s.project, s.compId).layers, s.keys[0]!.layer);
          keyClipboard = layer ? copyKeys(layer, s.keys) : null;
          if (keyClipboard) {
            clipboard = null;
            store.set({ status: `Copied ${s.keys.length} keyframe${s.keys.length > 1 ? 's' : ''}` });
          }
          return;
        }
        const layers = store.selected();
        if (!layers.length) return;
        keyClipboard = null;
        clipboard = cloneLayers(layers);"""),
("""      async paste() {
        let layers = clipboard;""", """      async paste() {
        if (keyClipboard) {
          const s = store.get();
          if (!s.selection.length) return store.set({ status: 'Select the layers to paste the keyframes on.' });
          const clip = keyClipboard;
          store.edit('Paste keyframes', (p) => pasteKeys(p, s.compId, s.selection, clip, s.time), { status: 'Pasted the keyframes at the playhead' });
          return;
        }
        let layers = clipboard;"""),
("import { RamPreview } from './ramPreview';", "import { RamPreview } from './ramPreview';\nimport { copyKeys, pasteKeys, type KeyClip } from './keyframes';"),
])

edit('titler/src/designer/Inspector.tsx', [
("""  return (
    <Section title="Animate" open={false}>
      <div className="tt-dim tt-small">Adds keyframes timed to the IN and OUT markers.</div>""", """  const [saved, setSaved] = useState(loadAnimPresets);
  const [step, setStep] = useState(3);
  const [bars, setBars] = useState(false);
  const selection = store.get().selection;
  return (
    <Section title="Animate" open={false}>
      <div className="tt-dim tt-small">Adds keyframes timed to the IN and OUT markers.</div>
      {selection.length > 1 && (
        <Row label="Stagger" hint="Each layer's animation a few frames after the one above it">
          <NumberField value={step} min={0} step={1} label="Stagger frames" unit="fr" onChange={(v) => setStep(Math.round(v))} />
          <Toggle value={bars} onChange={setBars} label="Bars too" />
          <button
            className="tt-btn"
            onClick={() =>
              store.edit(`Stagger ${selection.length} layers`, (p) => stagger(p, compId, inStackOrder(p, compId, selection), step / c.fps, bars))
            }
          >
            Stagger
          </button>
        </Row>
      )}
      <div className="tt-presets">
        <span>Saved</span>
        {saved.map((a) => (
          <span key={a.id} className="tt-chip tt-chip-split">
            <button
              onClick={() =>
                store.edit(`Apply “${a.name}”`, (p) => pasteKeys(p, compId, selection.length ? selection : [l.id], a.clip, store.get().time))
              }
              title="Put this animation on the selected layers, from the playhead"
            >
              {a.name}
            </button>
            <button aria-label={`Remove ${a.name}`} title="Remove this saved animation" onClick={() => setSaved(removeAnimPreset(a.id))}>
              ×
            </button>
          </span>
        ))}
        <button
          className="tt-chip"
          onClick={() => {
            const name = prompt('Name for this animation', `${l.name} animation`);
            if (name === null) return;
            if (saveAnimPreset(l, name)) setSaved(loadAnimPresets());
            else store.set({ status: 'This layer has no keyframes to save.' });
          }}
          title="Keep this layer's keyframes as an animation to give other layers"
        >
          <Plus size={11} /> Save this animation
        </button>
      </div>"""),
("import { applyTextStyle, differsFromStyle, newTextStyle, styleFromLayer } from './textStyles';", "import { applyTextStyle, differsFromStyle, newTextStyle, styleFromLayer } from './textStyles';\nimport { inStackOrder, loadAnimPresets, pasteKeys, removeAnimPreset, saveAnimPreset, stagger } from './keyframes';"),
])
s = open('titler/src/designer/designer.css').read()
s += '''
/* A saved animation: apply, or remove. */
.tt-chip-split {
  display: inline-flex;
  padding: 0;
}
.tt-chip-split button {
  padding: 2px 7px;
}
.tt-chip-split button + button {
  border-left: 1px solid var(--tt-line-2);
  color: var(--tt-dim);
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
