import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Inspector.tsx', [
("""      {l.shape === 'rect' && prop('roundness', 'Corners', 0, 'px', { min: 0 })}""", """      {l.shape === 'rect' && !l.corners && prop('roundness', 'Corners', 0, 'px', { min: 0 })}
      {l.shape === 'rect' && (
        <Row label={l.corners ? 'Corners' : ''} hint="Each corner its own radius: top left, top right, bottom right, bottom left">
          <Toggle
            value={!!l.corners}
            onChange={(on) =>
              upd('Each corner', (x) => {
                const r = num(x.roundness, store.get().time, 0);
                return { ...x, corners: on ? [r, r, r, r] : null, roundness: on ? x.roundness : { v: x.corners?.[0] ?? r } };
              })
            }
            label="Each corner"
          />
          {l.corners &&
            (['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map((name, i) => (
              <NumberField
                key={name}
                value={l.corners![i]!}
                min={0}
                label={`${name} corner`}
                unit="px"
                onChange={(v) =>
                  upd('Corner', (x) => ({ ...x, corners: x.corners ? (x.corners.map((c, j) => (j === i ? v : c)) as [number, number, number, number]) : null }))
                }
              />
            ))}
        </Row>
      )}"""),
("""          <Row label="Ends">
            <Select
              label="Line ends"
              value={l.stroke.cap ?? 'butt'}""", """          <Row label="Place" hint="Where the line sits on the outline">
            <Select
              label="Stroke place"
              value={l.stroke.align ?? 'center'}
              options={[
                ['center', 'Centered'],
                ['inside', 'Inside'],
                ['outside', 'Outside'],
              ]}
              onChange={(align) => upd('Stroke place', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, align: align === 'center' ? undefined : align } }))}
            />
            <Select
              label="Corners of the line"
              value={l.stroke.join ?? 'miter'}
              options={[
                ['miter', 'Sharp'],
                ['round', 'Round'],
                ['bevel', 'Bevel'],
              ]}
              onChange={(join) => upd('Line corners', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, join } }))}
            />
          </Row>
          <Row label="Ends">
            <Select
              label="Line ends"
              value={l.stroke.cap ?? 'butt'}"""),
("""              label="Dashed"
            />
          </Row>""", """              label="Dashed"
            />
          </Row>
          {!!l.stroke.dash?.length && (
            <Row label="Dashes">
              <NumberField
                value={l.stroke.dash[0] ?? 12}
                min={0}
                label="Dash length"
                unit="px"
                onChange={(d) => upd('Dashes', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, dash: [d, x.stroke?.dash?.[1] ?? 8] } }))}
              />
              <NumberField
                value={l.stroke.dash[1] ?? 8}
                min={0}
                label="Gap length"
                unit="px"
                onChange={(g) => upd('Dashes', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, dash: [x.stroke?.dash?.[0] ?? 12, g] } }))}
              />
            </Row>
          )}
          {(l.extraStrokes ?? []).map((ex, i) => (
            <div key={i} className="tt-subcard">
              <Row label={`Outline ${i + 2}`}>
                <NumberField
                  value={ex.width}
                  min={0}
                  label={`Outline ${i + 2} width`}
                  unit="px"
                  onChange={(width) => upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, width } : y)) }))}
                />
                <Select
                  label={`Outline ${i + 2} place`}
                  value={ex.align ?? 'center'}
                  options={[
                    ['center', 'Centered'],
                    ['inside', 'Inside'],
                    ['outside', 'Outside'],
                  ]}
                  onChange={(align) =>
                    upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, align } : y)) }))
                  }
                />
                <button
                  className="tt-ico"
                  aria-label={`Remove outline ${i + 2}`}
                  onClick={() => upd('Remove outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).filter((_, j) => j !== i) }))}
                >
                  <Trash2 size={13} />
                </button>
              </Row>
              <PaintField
                paint={ex.paint}
                label={`Outline ${i + 2} color`}
                onChange={(paint) => upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, paint } : y)) }))}
                tokens={tokens}
                vals={vals}
                fieldKeys={fieldKeys}
              />
            </div>
          ))}
          <Row label="">
            <button
              className="tt-link"
              onClick={() =>
                upd('Add outline', (x) => ({
                  ...x,
                  extraStrokes: [...(x.extraStrokes ?? []), { paint: { type: 'solid', color: '$text' }, width: 2, align: 'outside' }],
                }))
              }
              title="Another outline over the first (a double outline)"
            >
              + Another outline
            </button>
          </Row>"""),
("import { isAnimated, setValue, toggleKeys, valueAt, vec } from '../core/easing';", "import { isAnimated, num, setValue, toggleKeys, valueAt, vec } from '../core/easing';"),
])
print('ok')
