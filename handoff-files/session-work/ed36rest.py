def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''**Lumora Titler now: 35 ✅, 5 ◐, 3 ❌** (of 43 rows). Before this round it
had 18 ✅, 3 ◐ and 22 ❌.''','''**Lumora Titler now: 38 ✅, 3 ◐, 2 ❌** (of 43 rows). Before this round it
had 35 ✅, 5 ◐ and 3 ❌ (and 18 ✅, 3 ◐, 22 ❌ the round before that).''')
rep('''A designer that works like Figma and After Effects together: workspaces, tabs, a graph editor,''','''A designer that works like Figma and After Effects together: dockable panels and workspaces, tabs, typing on the canvas, a graph editor,''')
rep('''## Built in this round

- **HTML / OGraf template export**''','''## Built in this round

A bug hunt with the designer driven in a browser (every main workflow), then
the gaps.

- **Fixed**: text placed with the text tool could not be typed into (the
  keys went to the shortcuts: switching tools, playing, making layers);
  the same with notes; Escape did not close dialogs, and Delete or tool
  keys acted on the title behind an open dialog; Alt+R and Alt+T switched
  tools instead of adding keys; holding Space to move the view also
  played; opening a saved title dropped 3D rotation and depth, the camera
  distance and a format set to stand on its own; data sources were read
  every 5 s whatever their interval and only while the Data tab showed;
  the view bar wrapped onto two lines, the right panel's tabs wrapped, the
  timeline did not fill its width; the browser's own confirm and prompt
  boxes (and an alert) are now the designer's own.
- **Dockable panels**: every panel is a tab that is dragged into another
  group, above or below one (up to three stacked a side), or onto the
  other side; the line between groups shares the height; each workspace
  has its own docking and is reset from the Workspace menu.
  Alt+Shift+arrow moves a panel from the keyboard. (Panels do not float
  in windows of their own.)
- **3D with a camera**: a camera layer looks at a point, orbits it, rolls
  and moves in or out, animated like any layer; 3D layers are seen in true
  perspective and drawn far ones first; selection and clicks follow them.
- **Extrusion**: text, shapes and pictures get sides as deep as asked, in
  their own colors made darker or one color, shaded toward the back.
- **Components with any change per copy**: words, color, picture, shown,
  moved, scaled, turned and faded, on top of the layer's own animation;
  in Lottie as the copy's own precomposition.
- **Photoshop files in**: pixel layers as pictures in place with their
  opacity, blend mode and visibility, groups as groups (8 and 16 bits,
  RGB and grayscale); what does not come over is listed.
- **Typing on the canvas** in the layer's own font, size, spacing and
  color, turned with it; one undo step.
- **Layer and View menus**, a timeline that fits its width, a graph editor
  with a grid where keyframes are dragged, library thumbnails that show
  small graphics closer.

## Built in the round before

- **HTML / OGraf template export**''')
rep('''- **Full 3D (extruded text, lights, materials)**: needs a WebGL renderer
  next to the Canvas one, and every effect, mask and golden frame twice.
  2.5D layers with a camera cover card flips and depth moves, which is most
  of what live graphics use.
- **Dockable panels**: the four workspaces and resizable panels cover the
  common layouts; drag-to-dock tabs are a large UI change better done with
  user testing so it stays polished.
- **Overrides of any property in components**: copies differ by fields
  (words, colors, pictures), the overrides operators need; per-property
  overrides (Figma's) would need an override layer model across the
  renderer and every editor panel.
''','''- **Lights and materials, 3D models**: 3D layers, the camera and extruded
  sides cover card flips, depth moves and 3D type; lit materials and
  imported models need a WebGL renderer next to the Canvas one, and every
  effect, mask and golden frame twice.
- **Panels in windows of their own**: panels dock anywhere in the window;
  floating windows need the desktop app to manage several windows, and the
  web version cannot.
''')
rep('''- **After Effects projects, MOGRT and Photoshop files**: closed formats;
  Lottie is the open path from After Effects and works today.''','''- **After Effects projects and MOGRT**: closed formats; Lottie is the open
  path from After Effects and works today. Photoshop files are read (their
  pixel layers); layer masks, layer styles, adjustment layers and live
  text do not come over, and the import says so.''')
