import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/docs')
def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p,a)
        s=s.replace(a,b)
    open(p,'w').write(s)
edit('FEATURES.md', [
('''  - Designer: RAM preview (frames made ahead, memory cap, green cached bar), resizable panels and four workspaces, the canvas on its own, recent titles, undo history and versions, notes pinned on the canvas, keyboard shortcuts sheet''',
'''  - Designer: dockable panels (drag a tab into another group, above or below one, or to the other side; groups share the height; four workspaces, each with its own docking, reset from the Workspace menu), RAM preview (frames made ahead, memory cap, green cached bar), typing right on the canvas in the layer's own font, a Layer menu (text, shapes, null, camera, group, precompose, order), a View menu (safe areas, guides, grid, rulers, snapping, motion paths, notes), the timeline fitting the composition to its width (zoom in time with Ctrl+wheel), a graph editor with a value and time grid where keys are dragged, the canvas on its own, recent titles, undo history and versions, notes pinned on the canvas, keyboard shortcuts sheet; every dialog closes with Escape and holds the keyboard while open'''),
('''  - Interchange: export as an HTML template (CasparCG, SPX, OBS and vMix browser sources, H2R Graphics, LiveOS) that is also an EBU OGraf graphic, with fields, IN / OUT, formats, timers and its data sources working there; Lottie in (After Effects through Bodymovin, LottieFiles, Jitter) and out; SVG in as editable shapes (also pasted from Figma)''',
'''  - Interchange: export as an HTML template (CasparCG, SPX, OBS and vMix browser sources, H2R Graphics, LiveOS) that is also an EBU OGraf graphic, with fields, IN / OUT, formats, timers and its data sources working there; Lottie in (After Effects through Bodymovin, LottieFiles, Jitter) and out; SVG in as editable shapes (also pasted from Figma); Photoshop files in (each pixel layer a picture in place, with its opacity, blend mode and visibility; groups as groups)'''),
('''  - Design: titles in tabs, combined shapes (union, subtract, intersect, exclude), compound paths, several fills, path and mask morphs, 3D layers (X / Y rotation and depth through the composition's camera), components (each copy of a composition with its own field values), character styles, keyframe velocity and CSS cubic-bezier typed in''',
'''  - Design: titles in tabs, combined shapes (union, subtract, intersect, exclude), compound paths, several fills, path and mask morphs, 3D layers (X / Y rotation and depth in true perspective, far ones drawn first) seen through a camera layer that looks at a point, orbits it, rolls and moves in or out (animated like any layer), extruded text, shapes and pictures with shaded sides, components (each copy of a composition with its own field values and its own changes to any layer inside: words, color, picture, shown, moved, scaled, turned, faded), character styles, keyframe velocity and CSS cubic-bezier typed in'''),
('''3D seams, combined shapes, repeated rows, timers and formats following the main one''','''3D seams, the camera, extrusion and depth order, combined shapes, components' per-copy changes, repeated rows, timers and formats following the main one; every template and the newer settings kept through saving and opening; Photoshop layers read (raw and RLE, groups, Unicode names); designer regression tests for dialogs and the keyboard, typing on the canvas, notes, docking and data sources on their own intervals'''),
])

edit('COMPETITORS-TITLER.md', [
('''| 3D layers with a camera                                         |    ❌    |  ✅   |   ✅   |   ❌   | ❌  |   ✅    |    ✅     | ✅  |   ✅   |  ❌  |   ◐    |  ❌   |   ◐ new    |''',
 '''| 3D layers with a camera                                         |    ❌    |  ✅   |   ✅   |   ❌   | ❌  |   ✅    |    ✅     | ✅  |   ✅   |  ❌  |   ◐    |  ❌   |   ✅ new   |'''),
('''| Components with per-copy overrides                              |    ✅    |  ✅   |   ◐    |   ❌   | ❌  |   ❌    |     ◐     |  ◐  |   ❌   |  ✅  |   ❌   |  ✅   |   ◐ new    |''',
 '''| Components with per-copy overrides                              |    ✅    |  ✅   |   ◐    |   ❌   | ❌  |   ❌    |     ◐     |  ◐  |   ❌   |  ✅  |   ❌   |  ✅   |   ✅ new   |'''),
('''| Dockable panels                                                 |    ❌    |  ✅   |   ✅   |   ❌   | ❌  |   ❌    |    ✅     | ✅  |   ◐    |  ◐  |   ❌   |   ◐   |     ◐      |''',
 '''| Dockable panels                                                 |    ❌    |  ✅   |   ✅   |   ❌   | ❌  |   ❌    |    ✅     | ✅  |   ◐    |  ◐  |   ❌   |   ◐   |   ✅ new   |'''),
('''| After Effects projects and MOGRT, Photoshop files               |    ◐     |   ◐   |   ✅   |   ❌   | ❌  |   ✅    |     ◐     | ✅  |   ◐    |  ❌  |   ❌   |   ◐   |     ❌     |''',
 '''| After Effects projects and MOGRT, Photoshop files               |    ◐     |   ◐   |   ✅   |   ❌   | ❌  |   ✅    |     ◐     | ✅  |   ◐    |  ❌  |   ❌   |   ◐   |   ◐ new    |'''),
('''**Lumora Titler now: 35 ✅, 5 ◐, 3 ❌** (of 43 rows). Before this round it
had 18 ✅, 3 ◐ and 22 ❌.''','''**Lumora Titler now: 38 ✅, 3 ◐, 2 ❌** (of 43 rows). Before this round it
had 35 ✅, 5 ◐ and 3 ❌ (and 18 ✅, 3 ◐, 22 ❌ the round before that).'''),
('''| Broadcast tools are hard to learn and expensive to staff (Viz, XPression, Chyron)                                | A designer that works like Figma and After Effects together: workspaces, tabs, a graph editor, keyboard shortcuts, components, styles; 26 ready templates in neutral broadcast looks.     |''',
 '''| Broadcast tools are hard to learn and expensive to staff (Viz, XPression, Chyron)                                | A designer that works like Figma and After Effects together: dockable panels and workspaces, tabs, typing on the canvas, a graph editor, keyboard shortcuts, components, styles; 26 ready templates in neutral broadcast looks. |'''),
('''## Built in this round

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

- **HTML / OGraf template export**'''),
('''- **Full 3D (extruded text, lights, materials)**: needs a WebGL renderer
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
'''),
('''- **After Effects projects, MOGRT and Photoshop files**: closed formats;
  Lottie is the open path from After Effects and works today.''','''- **After Effects projects and MOGRT**: closed formats; Lottie is the open
  path from After Effects and works today. Photoshop files are read (their
  pixel layers); layer masks, layer styles, adjustment layers and live
  text do not come over, and the import says so.'''),
])
