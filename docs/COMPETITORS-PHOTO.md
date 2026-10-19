# Lumora Photo and its competitors

What the photo editors people compare offer in 2026, how Lumora Photo
compares, and where it is honestly behind. Read from the vendors' own pages
and release notes (October 2026); marks for other products are as their
public material describes them, and may miss features sold as add-ons or in
higher editions. Lumora Photo's marks are for what ships and is tested today
(`photo/src/**/*.test.ts`, `e2e/photo-smoke.mjs`); anything not good enough
yet is hidden in the app and marked ❌ here.

✅ has it ◐ partly, or through an add-on or another product ❌ does not

## The tools

| Short name | Product                                | What it is                                                       |
| ---------- | -------------------------------------- | ---------------------------------------------------------------- |
| Photoshop  | Adobe Photoshop 2026 (with Camera Raw) | The reference; subscription (about $23/month)                    |
| Affinity   | Affinity Photo 2                       | Desktop editor, one-time purchase                                |
| Photopea   | Photopea                               | Browser editor modeled on Photoshop; free with ads, paid without |
| GIMP       | GIMP 3                                 | Free, open source desktop editor                                 |
| Pixelmator | Pixelmator Pro                         | Mac editor, one-time purchase                                    |
| Krita      | Krita 5                                | Free, open source painting app                                   |
| Lightroom  | Adobe Lightroom Classic                | Photo library and raw development, subscription                  |

## Feature matrix

| Feature                                                                        | Photoshop | Affinity | Photopea | GIMP | Pixelmator | Krita | Lightroom | **Lumora Photo** |
| ------------------------------------------------------------------------------ | :-------: | :------: | :------: | :--: | :--------: | :---: | :-------: | :--------------: |
| **Documents and color**                                                        |           |          |          |      |            |       |           |                  |
| Layers, groups, opacity and fill opacity                                       |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| 27 Photoshop blend modes, same math                                            |    ✅     |    ◐     |    ✅    |  ◐   |     ◐      |   ◐   |    ❌     |        ✅        |
| Layer masks, vector masks, clipping masks                                      |    ✅     |    ✅    |    ✅    |  ◐   |     ◐      |   ◐   |    ❌     |        ✅        |
| Adjustment layers (all 16 Photoshop types)                                     |    ✅     |    ◐     |    ✅    |  ❌  |     ◐      |   ◐   |    ❌     |        ✅        |
| Fill layers (solid, gradient, pattern)                                         |    ✅     |    ✅    |    ✅    |  ❌  |     ◐      |   ◐   |    ❌     |        ✅        |
| Layer styles (shadow, glow, bevel, satin, overlays, stroke)                    |    ✅     |    ✅    |    ✅    |  ❌  |     ◐      |   ◐   |    ❌     |        ✅        |
| Smart objects with smart filters                                               |    ✅     |    ✅    |    ✅    |  ❌  |     ◐      |  ❌   |    ❌     |        ✅        |
| Layer comps                                                                    |    ✅     |    ❌    |    ✅    |  ❌  |     ❌     |  ❌   |    ❌     |        ✅        |
| 8, 16 and 32 bits per channel                                                  |    ✅     |    ✅    |    ◐     |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Color managed (sRGB, Display P3, Adobe RGB, embedded ICC)                      |    ✅     |    ✅    |    ◐     |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Artboards and slices                                                           |    ✅     |    ✅    |    ✅    |  ❌  |     ❌     |  ❌   |    ❌     |        ✅        |
| History panel, snapshots, history brush                                        |    ✅     |    ✅    |    ✅    |  ◐   |     ❌     |   ◐   |    ✅     |        ✅        |
| **Selections**                                                                 |           |          |          |      |            |       |           |                  |
| Marquees, lassos, magnetic lasso, polygonal lasso                              |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| Magic wand, quick selection, color range                                       |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |   ◐   |     ◐     |        ✅        |
| Object selection and Select Subject                                            |    ✅     |    ◐     |    ✅    |  ❌  |     ✅     |  ❌   |    ✅     |        ◐         |
| Select and Mask (edge refinement)                                              |    ✅     |    ✅    |    ✅    |  ◐   |     ◐      |  ❌   |    ❌     |        ✅        |
| Quick mask, alpha channels, save and load selections                           |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |   ◐   |    ❌     |        ✅        |
| Transform selection, grow, similar, border, smooth, feather                    |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| **Painting and retouching**                                                    |           |          |          |      |            |       |           |                  |
| Brush engine (spacing, scatter, texture, dual tip, pressure)                   |    ✅     |    ✅    |    ◐     |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| Mixer brush, smudge, color replacement                                         |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| Clone stamp, pattern stamp, healing brush, spot healing                        |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |   ◐   |     ◐     |        ✅        |
| Content-aware fill and the Remove tool                                         |    ✅     |    ✅    |    ✅    |  ◐   |     ✅     |  ❌   |    ✅     |        ✅        |
| Patch tool, red eye, dodge, burn, sponge                                       |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |   ◐   |     ◐     |        ✅        |
| Eraser, background eraser, magic eraser                                        |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| Gradient tool with editable gradient layers                                    |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| Paint bucket                                                                   |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| **Vector and type**                                                            |           |          |          |      |            |       |           |                  |
| Pen, freeform pen, curvature pen, anchor tools                                 |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| Shape layers (rectangle, ellipse, polygon, star, line, custom)                 |    ✅     |    ✅    |    ✅    |  ◐   |     ✅     |  ✅   |    ❌     |        ✅        |
| Paths panel (fill, stroke, load as selection, from selection)                  |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |   ◐   |    ❌     |        ✅        |
| Point and box type with Character and Paragraph panels                         |    ✅     |    ✅    |    ✅    |  ◐   |     ✅     |  ✅   |    ❌     |        ✅        |
| Text on a path                                                                 |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ❌   |    ❌     |        ✅        |
| Warp text                                                                      |    ✅     |    ✅    |    ✅    |  ❌  |     ◐      |  ❌   |    ❌     |        ✅        |
| OpenType features (ligatures, figures, small caps)                             |    ✅     |    ✅    |    ◐     |  ❌  |     ◐      |   ◐   |    ❌     |        ✅        |
| **Crop and transform**                                                         |           |          |          |      |            |       |           |                  |
| Crop with straighten, ratios, overlays                                         |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Content-aware crop edges                                                       |    ✅     |    ❌    |    ❌    |  ❌  |     ❌     |  ❌   |     ◐     |        ✅        |
| Perspective crop                                                               |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ❌   |     ◐     |        ✅        |
| Free transform, warp, perspective, distort                                     |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |     ◐     |        ✅        |
| Content-aware scale                                                            |    ✅     |    ❌    |    ✅    |  ❌  |     ❌     |  ❌   |    ❌     |        ✅        |
| Puppet warp and perspective warp                                               |    ✅     |    ✅    |    ✅    |  ◐   |     ❌     |   ◐   |    ❌     |        ❌        |
| Liquify                                                                        |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| **Adjustments and filters**                                                    |           |          |          |      |            |       |           |                  |
| Curves, levels and the other pixel adjustments                                 |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Shadows/Highlights, HDR toning, match and replace color                        |    ✅     |    ◐     |    ✅    |  ◐   |     ◐      |  ❌   |     ◐     |        ✅        |
| Camera Raw style develop (white balance to grain)                              |    ✅     |    ✅    |    ◐     |  ◐   |     ✅     |  ❌   |    ✅     |        ✅        |
| Blur family (Gaussian, motion, radial, lens, surface, field, iris, tilt-shift) |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| Sharpen (unsharp mask, smart sharpen, high pass)                               |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Noise (add, reduce, median, dust and scratches)                                |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Distort, pixelate, render and stylize filters                                  |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |    ❌     |        ✅        |
| Generative AI fill and expand in the cloud                                     |    ✅     |    ❌    |    ◐     |  ❌  |     ◐      |  ❌   |    ✅     |        ❌        |
| **Files**                                                                      |           |          |          |      |            |       |           |                  |
| Photoshop PSD: open and save with layers, masks, styles, text                  |    ✅     |    ◐     |    ✅    |  ◐   |     ◐      |   ◐   |    ❌     |        ✅        |
| PNG, JPEG, WebP, TIFF, GIF, BMP                                                |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |     ◐     |        ✅        |
| AVIF and HEIC                                                                  |    ✅     |    ◐     |    ◐     |  ◐   |     ✅     |   ◐   |    ✅     |        ◐         |
| DNG camera raw                                                                 |    ✅     |    ✅    |    ◐     |  ◐   |     ✅     |  ❌   |    ✅     |        ✅        |
| Other camera raw formats (CR3, NEF, ARW and more)                              |    ✅     |    ✅    |    ◐     |  ◐   |     ✅     |  ❌   |    ✅     |        ❌        |
| SVG placed as a smart object                                                   |    ✅     |    ✅    |    ✅    |  ◐   |     ✅     |   ◐   |    ❌     |        ✅        |
| Export As with preview, presets and file size                                  |    ✅     |    ✅    |    ✅    |  ◐   |     ✅     |   ◐   |    ✅     |        ✅        |
| **Workspace**                                                                  |           |          |          |      |            |       |           |                  |
| Dockable tabbed panels, customizable workspace                                 |    ✅     |    ✅    |    ✅    |  ✅  |     ◐      |  ✅   |     ◐     |        ✅        |
| Rulers, guides, grid, snap                                                     |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| Photoshop keyboard shortcuts, customizable                                     |    ✅     |    ◐     |    ✅    |  ◐   |     ◐      |   ◐   |    ❌     |        ✅        |
| Actions and batch processing                                                   |    ✅     |    ✅    |    ✅    |  ◐   |     ◐      |  ❌   |     ◐     |        ✅        |
| Print with preview                                                             |    ✅     |    ✅    |    ◐     |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| Dark and light interface                                                       |    ✅     |    ✅    |    ✅    |  ✅  |     ✅     |  ✅   |    ✅     |        ✅        |
| **Price and reach**                                                            |           |          |          |      |            |       |           |                  |
| Free                                                                           |    ❌     |    ❌    |    ◐     |  ✅  |     ❌     |  ✅   |    ❌     |        ✅        |
| Runs in the browser and as a desktop app                                       |     ◐     |    ◐     |    ◐     |  ❌  |     ❌     |  ❌   |    ❌     |        ✅        |
| No account, works offline                                                      |    ❌     |    ✅    |    ❌    |  ✅  |     ✅     |  ✅   |    ❌     |        ✅        |
| Sends pictures to a live production and video editor                           |    ❌     |    ❌    |    ❌    |  ❌  |     ❌     |  ❌   |    ❌     |        ✅        |

## Counts

Out of the 65 features above:

|                       | Photoshop | Affinity | Photopea |  GIMP   | Pixelmator |  Krita  | Lightroom | **Lumora Photo** |
| --------------------- | :-------: | :------: | :------: | :-----: | :--------: | :-----: | :-------: | :--------------: |
| ✅ has it             |    61     |    51    |    50    |   33    |     31     |   28    |    17     |        60        |
| ◐ partly              |     1     |    8     |    12    |   18    |     25     |   18    |    10     |        2         |
| ❌ does not           |     3     |    6     |    3     |   14    |     9      |   19    |    38     |        3         |
| Score (✅ = 1, ◐ = ½) | 61.5 / 65 | 55 / 65  | 56 / 65  | 42 / 65 | 43.5 / 65  | 37 / 65 |  22 / 65  |     61 / 65      |

## Where Lumora Photo is behind

- **Object selection and Select Subject (◐)**: done on the computer with a
  classical method (color clusters around the box or the picture's center,
  refined with a guided filter). It is good on clear subjects against a
  plain background and weaker on busy scenes and hair; Select and Mask's edge
  radius helps. Photoshop and Lightroom use trained models in the cloud or on
  the device. A downloaded on-device model (license-permissive, checked by
  hash) is the planned upgrade; it is not shipped until it is clearly better.
- **AVIF and HEIC (◐)**: opened wherever the browser or Windows can decode
  them; AVIF export appears only when the browser can encode it. There is no
  HEIC export.
- **Puppet Warp and Perspective Warp (❌)**: not good enough yet, so hidden.
  Free Transform's warp mesh, perspective and distort cover many of the same
  jobs; Liquify covers organic reshaping.
- **Other camera raw formats (❌)**: DNG is developed by Lumora Photo's own
  decoder (lossless JPEG, demosaic, the camera's color matrix, into 16-bit
  Display P3). Canon, Nikon and Sony raw files need a well-tested raw library
  with a permissive license; none was good enough to ship. Convert them to
  DNG with the free Adobe DNG Converter.
- **Generative AI in the cloud (❌, by design)**: Lumora Photo never uploads
  pictures. Content-aware fill, the Remove tool and content-aware crop edges
  run on the computer (PatchMatch).

## What people complain about in the others, and what Lumora Photo does

| Complaint                                               | Lumora Photo                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Photoshop's subscription and the account it needs       | Free, no account, works offline                                                                                        |
| Photopea's ads and that it lives only in a browser tab  | No ads; the same app installs on Windows with real files                                                               |
| GIMP's unfamiliar tools and shortcuts                   | Photoshop's tool names, panels and default shortcuts (all customizable)                                                |
| PSD files that open without their layers, masks or text | PSD read and written with groups, masks, vector masks, clipping, adjustment and fill layers, layer styles and type     |
| Slow previews on large pictures                         | A tiled GPU compositor that redraws only what changed; filters run in background workers, split across processor cores |
| Getting a picture into a live show or an edit           | File ▸ Send To puts it straight into Lumora, Lumora Studio or Lumora Titler                                            |
