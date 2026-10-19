import sys
# Columns: PS, Affinity, Photopea, GIMP, Pixelmator, Krita, Lightroom, Lumora Photo
# Y = has it, P = partly / add-on, N = no
COLS = ['Photoshop', 'Affinity', 'Photopea', 'GIMP', 'Pixelmator', 'Krita', 'Lightroom', '**Lumora Photo**']
ROWS = [
    ('Documents and color', None),
    ('Layers, groups, opacity and fill opacity', 'YYYYYYNY'),
    ('27 Photoshop blend modes, same math', 'YPYPPPNY'),
    ('Layer masks, vector masks, clipping masks', 'YYYPPPNY'),
    ('Adjustment layers (all 16 Photoshop types)', 'YPYNPPNY'),
    ('Fill layers (solid, gradient, pattern)', 'YYYNPPNY'),
    ('Layer styles (shadow, glow, bevel, satin, overlays, stroke)', 'YYYNPPNY'),
    ('Smart objects with smart filters', 'YYYNPNNY'),
    ('Layer comps', 'YNYNNNNY'),
    ('8, 16 and 32 bits per channel', 'YYPYYYYY'),
    ('Color managed (sRGB, Display P3, Adobe RGB, embedded ICC)', 'YYPYYYYY'),
    ('Artboards and slices', 'YYYNNNNY'),
    ('History panel, snapshots, history brush', 'YYYPNPYY'),
    ('Selections', None),
    ('Marquees, lassos, magnetic lasso, polygonal lasso', 'YYYYPYNY'),
    ('Magic wand, quick selection, color range', 'YYYYYPPY'),
    ('Object selection and Select Subject', 'YPYNYNYP'),
    ('Select and Mask (edge refinement)', 'YYYPPNNY'),
    ('Quick mask, alpha channels, save and load selections', 'YYYYPPNY'),
    ('Transform selection, grow, similar, border, smooth, feather', 'YYYYPYNY'),
    ('Painting and retouching', None),
    ('Brush engine (spacing, scatter, texture, dual tip, pressure)', 'YYPYPYNY'),
    ('Mixer brush, smudge, color replacement', 'YYYYPYNY'),
    ('Clone stamp, pattern stamp, healing brush, spot healing', 'YYYYYPPY'),
    ('Content-aware fill and the Remove tool', 'YYYPYNYY'),
    ('Patch tool, red eye, dodge, burn, sponge', 'YYYYPPPY'),
    ('Eraser, background eraser, magic eraser', 'YYYYYYNY'),
    ('Gradient tool with editable gradient layers', 'YYYYYYNY'),
    ('Paint bucket', 'YYYYYYNY'),
    ('Vector and type', None),
    ('Pen, freeform pen, curvature pen, anchor tools', 'YYYYYYNY'),
    ('Shape layers (rectangle, ellipse, polygon, star, line, custom)', 'YYYPYYNY'),
    ('Paths panel (fill, stroke, load as selection, from selection)', 'YYYYPPNY'),
    ('Point and box type with Character and Paragraph panels', 'YYYPYYNY'),
    ('Text on a path', 'YYYYYNNY'),
    ('Warp text', 'YYYNPNNY'),
    ('OpenType features (ligatures, figures, small caps)', 'YYPNPPNY'),
    ('Crop and transform', None),
    ('Crop with straighten, ratios, overlays', 'YYYYYYYY'),
    ('Content-aware crop edges', 'YNNNNNPY'),
    ('Perspective crop', 'YYYYPNPY'),
    ('Free transform, warp, perspective, distort', 'YYYYYYPY'),
    ('Content-aware scale', 'YNYNNNNY'),
    ('Puppet warp and perspective warp', 'YYYPNPNN'),
    ('Liquify', 'YYYYYYNY'),
    ('Adjustments and filters', None),
    ('Curves, levels and the other pixel adjustments', 'YYYYYYYY'),
    ('Shadows/Highlights, HDR toning, match and replace color', 'YPYPPNPY'),
    ('Camera Raw style develop (white balance to grain)', 'YYPPYNYY'),
    ('Blur family (Gaussian, motion, radial, lens, surface, field, iris, tilt-shift)', 'YYYYPYNY'),
    ('Sharpen (unsharp mask, smart sharpen, high pass)', 'YYYYYYYY'),
    ('Noise (add, reduce, median, dust and scratches)', 'YYYYYYYY'),
    ('Distort, pixelate, render and stylize filters', 'YYYYPYNY'),
    ('Generative AI fill and expand in the cloud', 'YNPNPNYN'),
    ('Files', None),
    ('Photoshop PSD: open and save with layers, masks, styles, text', 'YPYPPPNY'),
    ('PNG, JPEG, WebP, TIFF, GIF, BMP', 'YYYYYYPY'),
    ('AVIF and HEIC', 'YPPPYPYP'),
    ('DNG camera raw', 'YYPPYNYY'),
    ('Other camera raw formats (CR3, NEF, ARW and more)', 'YYPPYNYN'),
    ('SVG placed as a smart object', 'YYYPYPNY'),
    ('Export As with preview, presets and file size', 'YYYPYPYY'),
    ('Workspace', None),
    ('Dockable tabbed panels, customizable workspace', 'YYYYPYPY'),
    ('Rulers, guides, grid, snap', 'YYYYYYNY'),
    ('Photoshop keyboard shortcuts, customizable', 'YPYPPPNY'),
    ('Actions and batch processing', 'YYYPPNPY'),
    ('Print with preview', 'YYPYYYYY'),
    ('Dark and light interface', 'YYYYYYYY'),
    ('Price and reach', None),
    ('Free', 'NNPYNYNY'),
    ('Runs in the browser and as a desktop app', 'PPPNNNNY'),
    ('No account, works offline', 'NYNYYYNY'),
    ('Sends pictures to a live production and video editor', 'NNNNNNNY'),
]
SYM = {'Y': '✅', 'P': '◐', 'N': '❌'}
lines = []
head = '| Feature | ' + ' | '.join(COLS) + ' |'
sep = '| --- | ' + ' | '.join(':-:' for _ in COLS) + ' |'
lines += [head, sep]
counts = [[0, 0, 0] for _ in COLS]
total = 0
for name, marks in ROWS:
    if marks is None:
        lines.append(f'| **{name}** |' + ' |' * len(COLS))
        continue
    total += 1
    lines.append(f'| {name} | ' + ' | '.join(SYM[m] for m in marks) + ' |')
    for i, m in enumerate(marks):
        counts[i]['YPN'.index(m)] += 1
lines.append('')
summary = ['| | ' + ' | '.join(COLS) + ' |', '| --- | ' + ' | '.join(':-:' for _ in COLS) + ' |']
summary.append('| ✅ has it | ' + ' | '.join(str(c[0]) for c in counts) + ' |')
summary.append('| ◐ partly | ' + ' | '.join(str(c[1]) for c in counts) + ' |')
summary.append('| ❌ does not | ' + ' | '.join(str(c[2]) for c in counts) + ' |')
summary.append('| Score (✅ = 1, ◐ = ½) | ' + ' | '.join(f'{c[0] + c[1] / 2:g} / {total}' for c in counts) + ' |')
out = open(sys.argv[1], 'w')
out.write('\n'.join(lines) + '\n<!-- counts -->\n' + '\n'.join(summary) + '\n')
print(total, counts)
