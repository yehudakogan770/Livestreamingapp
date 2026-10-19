
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

| Complaint | Lumora Photo |
| --- | --- |
| Photoshop's subscription and the account it needs | Free, no account, works offline |
| Photopea's ads and that it lives only in a browser tab | No ads; the same app installs on Windows with real files |
| GIMP's unfamiliar tools and shortcuts | Photoshop's tool names, panels and default shortcuts (all customizable) |
| PSD files that open without their layers, masks or text | PSD read and written with groups, masks, vector masks, clipping, adjustment and fill layers, layer styles and type |
| Slow previews on large pictures | A tiled GPU compositor that redraws only what changed; filters run in background workers, split across processor cores |
| Getting a picture into a live show or an edit | File ▸ Send To puts it straight into Lumora, Lumora Studio or Lumora Titler |
