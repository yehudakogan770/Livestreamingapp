import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/docs')
def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p,a)
        s=s.replace(a,b)
    open(p,'w').write(s)
edit('COMPETITORS-TITLER.md', [
('''- **Typing on the canvas** in the layer's own font, size, spacing and
  color, turned with it; one undo step.''','''- **Masks and paths edited on the canvas**: a mask's outline and points
  shown on the selected layer, points and handles dragged (Alt-drag a
  point to round it), the whole mask moved, its box typed in;
  double-click a path shape to do the same. The stopwatch makes a mask or
  path change form over time, with its keys in the timeline. Before, masks
  were added at one fixed size and shape morphs came only from Lottie.
- **Typing on the canvas** in the layer's own font, size, spacing and
  color, turned with it; one undo step. The text tool on a text layer
  types into it.'''),
])
edit('FEATURES.md', [
('''typing right on the canvas in the layer's own font, a Layer menu''','''typing right on the canvas in the layer's own font, masks and path points edited on the canvas (handles, rounding, the box typed in) and animated (keys of the whole outline, in the timeline), a Layer menu'''),
('''the camera, extrusion and depth order,''','''the camera, extrusion and depth order, mask and path editing and their keys, library thumbnails framed on the graphic,'''),
])
