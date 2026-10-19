import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='designer.css'; s=open(p).read()
a='''  min-width: 0;
  overflow: hidden;
}
.tt-top > * {
  flex-shrink: 0;
}'''
assert a in s
s=s.replace(a,'''  min-width: 0;
}
.tt-top > * {
  flex-shrink: 0;
}''')
open(p,'w').write(s)
p='Inspector.tsx'; s=open(p).read()
a=s.index('''                  {(l.extrude?.depth ?? 0) > 0 && (
                    <Row label="Sides"''')
b=s.index('''                </>
              )}
            </>
          )}
        </Section>
      )}''')
s=s[:a]+'''                  {(l.extrude?.depth ?? 0) > 0 && (
                    <Row label="Sides" hint="The sides' color: the layer's own colors made darker, or one color">
                      <Select
                        label="Side color kind"
                        value={l.extrude?.color ? 'color' : 'own'}
                        options={[
                          ['own', 'Own colors, darker'],
                          ['color', 'One color'],
                        ]}
                        onChange={(v) =>
                          updOne('Extrude color', (x) => (x.extrude ? { ...x, extrude: v === 'own' ? { depth: x.extrude.depth } : { ...x.extrude, color: '$boxAlt' } } : x))
                        }
                      />
                      {l.extrude?.color && (
                        <ColorField
                          value={l.extrude.color}
                          label="Side color"
                          tokens={tokens}
                          values={vals}
                          fields={fieldKeys}
                          onChange={(color) => updOne('Extrude color', (x) => (x.extrude ? { ...x, extrude: { ...x.extrude, color: color || '$boxAlt' } } : x))}
                        />
                      )}
                    </Row>
                  )}
'''+s[b:]
s=s.replace("{prop('transform.rotationX', 'Orbit up and down', 0, '°')}","{prop('transform.rotationX', 'Orbit vertical', 0, '°')}")
open(p,'w').write(s)
