
---

## 30. Lumora Photo (photo editing and design)

Its own desktop app (Lumora-Photo-Setup.exe, crate `lumora-photo`, updates
from `latest-photo.json`) and a web app (docs/photo, lumoraproduction.com/photo/,
works offline), one code base in `photo/`. Compared with Photoshop, Affinity
Photo, Photopea, GIMP, Pixelmator Pro, Krita and Lightroom in
`COMPETITORS-PHOTO.md` (60 of 65 ✅, 2 ◐, 3 ❌).

- ✅ **Documents** — sparse 256-pixel tiles, 8, 16 or 32 bits per channel, sRGB, Display P3, Adobe RGB and embedded ICC profiles; drawn by a WebGL2 GPU compositor that redraws only what changed and shows the picture color-managed on P3 screens
- ✅ **Layers** — pixel, group (and pass through), adjustment (all 16 Photoshop types), fill (solid, gradient, pattern), type, shape and smart objects with smart filters; 27 blend modes with Photoshop's math; layer and vector masks, clipping, layer styles (ten effects), locks, layer comps, artboards and slices
- ✅ **Selections** — marquees, lassos (free, polygonal, magnetic), object selection, quick selection, magic wand, color range, Select Subject (classical, on the computer), Select and Mask, quick mask, alpha channels, modify, grow, similar, transform
- ✅ **Painting and retouching** — brush engine (spacing, scatter, jitter, texture, dual tip, pen pressure, smoothing), pencil, mixer brush, color replacement, clone and pattern stamps, history brush and snapshots, healing and spot healing, Remove tool and content-aware fill (PatchMatch), patch, red eye, erasers, gradient (editable gradient layers), bucket, blur, sharpen, smudge, dodge, burn, sponge
- ✅ **Vector and type** — pen, freeform and curvature pens, anchor tools, path and direct selection, shapes and custom shapes, the Paths panel; point, box and on-path type with Character and Paragraph panels, warp text
- ✅ **Crop and transform** — crop with straighten, ratios, overlays and content-aware edges, perspective crop, free transform with warp, content-aware scale, Liquify, canvas and image size
- ✅ **Adjustments and filters** — every adjustment on the pixels too, auto tone / contrast / color, Shadows/Highlights, HDR toning, match and replace color, Camera Raw (white balance to grain), blur family and blur gallery, sharpen, noise, distort, pixelate, render, stylize; filters run in workers, previewed on the canvas
- ✅ **Files** — .lumphoto (zip of JSON and tiles); Photoshop PSD read and written with groups, masks, vector masks, clipping, adjustment and fill layers, layer styles and type; PNG (16-bit, ICC), JPEG, WebP, TIFF (LZW, Deflate, 16 and 32-bit), GIF, BMP; DNG raw; SVG placed as a smart object; AVIF and HEIC where the browser can; Export As with preview, presets and file size; artboards and slices to files
- ✅ **Workspace** — Photoshop's menus, tools and default shortcuts (customizable), dockable tabbed panels (Layers, Channels, Paths, Properties, Adjustments, History, Color, Swatches, Brushes, Character, Paragraph, Navigator, Info, Histogram, Actions, Layer Comps), rulers, guides, grid, actions and batch, print, a start screen with sizes and recent files, dark and light themes
- ✅ **Family** — File ▸ Send To puts a picture in Documents/Lumora/Pictures for Lumora and Lumora Studio, or a title in Documents/Lumora/Titles for Lumora Titler
- **Proven by:** blend-mode math against Photoshop's formulas, adjustments, selections, history (tiles swapped and snapshots), PNG / ICC / zip / .lumphoto / PSD / TIFF / GIF / BMP / SVG path round trips, content-aware fill on a texture (`photo/src/**/*.test.ts`); in Chromium with WebGL (`e2e/photo-smoke.mjs`): a document made and painted, adjustment, gradient and type layers, the GPU composite equal to the CPU one, PSD and .lumphoto round trips, selection, fill, undo, crop, dialogs and workspaces opened without errors
- ⬜ Still to come: a downloaded on-device model for object selection, Puppet Warp and Perspective Warp (hidden until good), camera raw formats other than DNG, HEIC export
