import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src')
p='core/build.ts'; s=open(p).read()
s=s.replace('''export function newCompLayer(''','''/** A camera for the composition's 3D layers, looking at its middle. */
export function newCamera(comp: Composition): NullLayer {
  const l = newNull(comp, [comp.width / 2, comp.height / 2]);
  return { ...l, name: 'Camera', camera: true, transform: { ...l.transform, rotationX: still(0), rotationY: still(0), z: still(0) } };
}

export function newCompLayer(''')
open(p,'w').write(s)

p='designer/Designer.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep("import { cloneLayers, newProject, newText } from '../core/build';","import { cloneLayers, newCamera, newNull, newProject, newShape, newText } from '../core/build';")
rep('''            <button onClick={() => setRenderOpen(true)} title="Render to a film or PNG sequence">''','''            <MenuButton label={<span className="tt-menu-text-keep">Layer</span>} title="Add layers, and arrange the selected ones">
              {(close) => {
                const go = (f: () => void) => () => (f(), close());
                const camera = c.layers.find((l) => l.type === 'null' && l.camera);
                return (
                  <>
                    <MenuItem onClick={go(() => cmd.addText())} hint="N">
                      Text
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.addShape('rect'))} hint="R">
                      Rectangle
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.addShape('ellipse'))} hint="E">
                      Ellipse
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.addNull())}>Null (to parent layers to)</MenuItem>
                    <MenuItem onClick={go(() => (camera ? store.set({ selection: [camera.id] }) : cmd.addCamera()))}>
                      {camera ? 'Select the camera' : 'Camera (for 3D layers)'}
                    </MenuItem>
                    <MenuSep />
                    <MenuItem onClick={go(() => cmd.duplicate())} hint="Ctrl+D">
                      Duplicate
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.group())} hint="Ctrl+G">
                      Group
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.ungroup())} hint="Ctrl+Shift+G">
                      Ungroup
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.precompose())} hint="Ctrl+Shift+C">
                      Precompose
                    </MenuItem>
                    <MenuSep />
                    <MenuItem onClick={go(() => cmd.restack('front'))} hint="Ctrl+Shift+]">
                      Bring to front
                    </MenuItem>
                    <MenuItem onClick={go(() => cmd.restack('back'))} hint="Ctrl+Shift+[">
                      Send to back
                    </MenuItem>
                    <MenuSep />
                    <MenuItem onClick={go(() => cmd.remove())} hint="Delete">
                      Delete
                    </MenuItem>
                  </>
                );
              }}
            </MenuButton>
            <button onClick={() => setRenderOpen(true)} title="Render to a film or PNG sequence">''')
rep('''      addText() {
        const c = store.comp();
        const l = newText(c, 'Text', [Math.round(c.width * 0.1), Math.round(c.height * 0.75)]);
        store.edit('Add text', (p) => addLayers(p, c.id, [l], sel()[0] ?? null), { selection: [l.id], editingText: l.id });
      },''','''      addText() {
        const c = store.comp();
        const l = newText(c, 'Text', [Math.round(c.width * 0.1), Math.round(c.height * 0.75)]);
        store.edit('Add text', (p) => addLayers(p, c.id, [l], sel()[0] ?? null), { selection: [l.id], editingText: l.id });
      },
      addShape(kind: 'rect' | 'ellipse') {
        const c = store.comp();
        const size: [number, number] = kind === 'ellipse' ? [240, 240] : [480, 160];
        const l = newShape(c, kind, [Math.round((c.width - size[0]) / 2), Math.round((c.height - size[1]) / 2)], size, '$accent');
        store.edit(kind === 'ellipse' ? 'Add ellipse' : 'Add rectangle', (p) => addLayers(p, c.id, [l], sel()[0] ?? null), { selection: [l.id] });
      },
      addNull() {
        const c = store.comp();
        const l = newNull(c, [Math.round(c.width / 2), Math.round(c.height / 2)]);
        store.edit('Add null', (p) => addLayers(p, c.id, [l], sel()[0] ?? null), { selection: [l.id] });
      },
      addCamera() {
        const c = store.comp();
        const l = newCamera(c);
        // On top of the list, where it is easy to find.
        store.edit('Add camera', (p) => addLayers(p, c.id, [l], c.layers[0]?.id ?? null), {
          selection: [l.id],
          status: 'A camera: 3D layers are seen through it. Orbit and move it in the Camera section, and animate it like any layer.',
        });
      },''')
open(p,'w').write(s)
