import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Inspector.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
a=s.index('      <Section title="Transform">')
b=s.index("      {l.type === 'text' && <TextSection")
new='''      {l.type === 'null' && l.camera ? (
        <Section title="Camera">
          <div className="tt-dim tt-small">
            3D layers are seen through this camera: it looks at a point, orbits around it and moves in or out. Animate it like any layer.
          </div>
          {prop('transform.position', 'Looks at', [c.width / 2, c.height / 2], 'px')}
          {prop('transform.rotationY', 'Orbit across', 0, '°')}
          {prop('transform.rotationX', 'Orbit up and down', 0, '°')}
          {prop('transform.rotation', 'Roll', 0, '°')}
          {prop('transform.z', 'Move away', 0, 'px')}
          <Row label="Lens" hint="How far the camera is from the point it looks at (nearer: stronger perspective); the same for every camera of this composition">
            <NumberField
              value={c.perspective ?? 2000}
              step={50}
              min={200}
              max={20000}
              label="Camera distance"
              unit="px"
              onChange={(perspective) => store.edit('Camera distance', (p) => updateComp(p, c.id, (x) => ({ ...x, perspective: Math.round(perspective) })))}
            />
          </Row>
        </Section>
      ) : (
        <Section title="Transform">
          {prop('transform.position', 'Position', [0, 0], 'px')}
          {prop('transform.scale', 'Scale', [100, 100], '%')}
          {prop('transform.rotation', 'Rotation', 0, '°')}
          {prop('transform.opacity', 'Opacity', 100, '%', { min: 0, max: 100 })}
          {prop('transform.anchor', 'Anchor point', [0, 0], 'px')}
          <div className="tt-btnrow">
            <button
              onClick={() => {
                const b = layerBox(lookOf(store.get()), l);
                const a = vec(l.transform.anchor, time, [0, 0]);
                const pos = vec(l.transform.position, time, [0, 0]);
                const na: Vec2 = [b.x + b.w / 2, b.y + b.h / 2];
                // Keep it where it is: the position moves by the same amount (unscaled, unturned).
                updOne('Center anchor point', (x) => ({
                  ...x,
                  transform: {
                    ...x.transform,
                    anchor: { v: na },
                    position: isAnimated(x.transform.position) ? x.transform.position : { v: [pos[0] + na[0] - a[0], pos[1] + na[1] - a[1]] },
                  },
                }));
              }}
            >
              Center anchor point
            </button>
          </div>
          {l.type !== 'null' && (
            <Row label="3D" hint="Turn the layer in depth about its anchor point (center it for a card flip) and see it through the composition's camera">
              <Toggle
                value={!!(l.transform.rotationX || l.transform.rotationY || l.transform.z)}
                label="3D layer"
                onChange={(on) =>
                  updOne(on ? 'Make 3D' : 'Make flat', (x) => {
                    const { rotationX: _x, rotationY: _y, z: _z, ...flat } = x.transform;
                    return on
                      ? { ...x, transform: { ...flat, rotationX: { v: 0 }, rotationY: { v: 0 }, z: { v: 0 } } }
                      : { ...x, transform: flat, extrude: undefined };
                  })
                }
              />
            </Row>
          )}
          {(l.transform.rotationX || l.transform.rotationY || l.transform.z) && (
            <>
              {prop('transform.rotationX', 'X rotation', 0, '°')}
              {prop('transform.rotationY', 'Y rotation', 0, '°')}
              {prop('transform.z', 'Depth (Z)', 0, 'px')}
              {(l.type === 'text' || l.type === 'shape' || l.type === 'image') && (
                <>
                  <Row label="Extrude" hint="Give the layer sides, this deep (0: flat); turn it to see them">
                    <NumberField
                      value={l.extrude?.depth ?? 0}
                      min={0}
                      max={400}
                      step={1}
                      label="Extrude depth"
                      unit="px"
                      onChange={(depth) =>
                        updOne('Extrude', (x) => ({ ...x, extrude: depth > 0 ? { ...(x.extrude ?? {}), depth: Math.round(depth) } : undefined }))
                      }
                    />
                  </Row>
                  {(l.extrude?.depth ?? 0) > 0 && (
                    <Row label="Sides" hint="The sides' color (empty: the layer's own colors, darker)">
                      <ColorField
                        value={l.extrude?.color ?? ''}
                        label="Side color"
                        tokens={tokens}
                        values={vals}
                        fields={fieldKeys}
                        onChange={(color) => updOne('Extrude color', (x) => (x.extrude ? { ...x, extrude: { ...x.extrude, color: color || undefined } } : x))}
                      />
                      {l.extrude?.color && (
                        <button className="tt-link" onClick={() => updOne('Extrude color', (x) => (x.extrude ? { ...x, extrude: { depth: x.extrude.depth } } : x))}>
                          Own colors
                        </button>
                      )}
                    </Row>
                  )}
                </>
              )}
            </>
          )}
        </Section>
      )}

'''
s=s[:a]+new+s[b:]
rep("import { compOf, findLayer, flatLayers, setParent, updateLayers } from './ops';","import { compOf, findLayer, flatLayers, setParent, updateComp, updateLayers } from './ops';")
open(p,'w').write(s)
