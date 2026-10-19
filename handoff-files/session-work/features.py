import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='docs/FEATURES.md'
s=open(p).read()
a="""  - 24 starter templates in a plain broadcast style; the title library in Documents/Lumora/Titles is shared by the three apps
"""
b="""  - 24 starter templates in a plain broadcast style; the title library in Documents/Lumora/Titles is shared by the three apps
  - Audio cues: a cue marker's sound plays on air through Lumora's sound engine on the mixes chosen (Stream, Hall, Recording), on its frame, with Blank and PANIC; mixed into Studio exports; heard in the preview and in the Titler's own films
  - A title's own data sources on air in Lumora (read by the control window, rows chosen on the card and the graphics seat, Shift+[ / ] steps; sample < the title's data < typed < Lumora bindings)
  - Formats: the title in 9:16, 1:1, 4:5 and 4K made by layer constraints (pin, scale, stretch); on air the format closest to the picture's shape is drawn
  - Designer: RAM preview (frames made ahead, memory cap, green cached bar), resizable panels and four workspaces, the canvas on its own, recent titles, undo history and versions, notes pinned on the canvas, keyboard shortcuts sheet
  - Typography: font picker, tabular figures, kerning on/off, small caps, justify, baseline shift, shared text styles; shapes with a radius per corner, strokes inside/centered/outside and more outlines; Outline, Gradient overlay, Color correction and Grain effects; pro color picker with eyedropper and swatches
  - Animation: expressions (wiggle, loops, time, links to other layers), keyframes copied across layers, saved animation presets, stagger; frame-exact video layers in renders and Studio exports (WebCodecs)
  - Studio opens the designer in its own window; the Titler installer has its own header and sidebar pictures
"""
assert a in s
s=s.replace(a,b)
s=s.replace("""  - **Proven by:** golden frames, format/migration, easing, layout, binding and packaging tests, designer component tests, a Titler overlay taken in and out in Lumora, and a Studio title clip checked frame by frame""","""  - **Proven by:** golden frames, format/migration, easing, layout, binding and packaging tests, designer component tests, a Titler overlay taken in and out in Lumora, a Studio title clip checked frame by frame; cue timing (frame-exact, loops, PANIC), cache invalidation, frame-exact decoding of a generated film (and in Chromium: e2e/titler-exact-video.mjs), data merge order, the Studio window round trip, expressions, formats, typography and effects on the pixels""")
open(p,'w').write(s)
print('ok')
