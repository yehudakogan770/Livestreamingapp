@@@
  `VerticalFrame` draws it (the whole picture across the middle over a soft,
  darkened copy stretched up from a 48 × 27 target). FFmpeg is started and
===
  `VerticalFrame` draws it (the whole picture across the middle over a soft,
  darkened copy stretched up from a 48 × 27 target, with its soft shadow
  under the picture: a Gaussian-blurred rectangle, Phase 3). FFmpeg is started and
@@@
renderer leaves the background out (see-through), so the engine's pictures
show through. The layer is grouped when it fades, so it fades as one.
===
renderer leaves the background out (see-through), so the engine's pictures
show through. The layer is grouped when it fades, so it fades as one. A
camera or video coming up as a slide fades in with the slides' `slide-in`
(0.4 s, CSS ease-out, from the slide's change: `Placement::appear`), as the
web's slide does.
@@@
  ending without looping); slides and Pesukim with a camera behind.
===
  ending without looping); slides and Pesukim with a camera behind.
- Phase 3, more (`cargo test -p lumora-live-engine`): an encoded picture
  copied into the file (a real FFmpeg: every frame, pieces of any size, a
  failing encoder ending the feed with its reason); zero-copy through the
  stand-in (the GPU ring, frames owed, the file's frames and colors, the
  route) and its fallback; Media Foundation's vendor names and the app's
  settings in its words; parameter sets found in a stream; graphics cards'
  keys and which card drives a display; an output copied to another device;
  HDR windows (scRGB and PQ values of SDR white, read back from `Rgba16Float`
  and `Rgb10a2Unorm`); HDR inputs (PQ and HLG maths, 10-bit RGB and P010 on
  the GPU against `hdr.rs`, a real HDR10 file told apart and decoded as 10-bit
  RGB); a camera as a slide fading in; the vertical version's shadow; a
  graphics input's multiview tile while not on air. `cargo clippy -p
lumora-live-engine --all-targets --target x86_64-pc-windows-msvc` checks
  `zerocopy_win.rs` and the DXGI and Media Foundation parts.
@@@
  (`nextPlanes`), `recorderUnified` (replay kept by the engine),
  `engineReport` (person finding).
===
  (`nextPlanes`, `multiviewPlanes`), `recorderUnified` (replay kept by the
  engine), `engineReport` (person finding; the zero-copy route, the engine's
  card and each window's card and colors).
@@@
7. "Test the engine's recording": file plays, 600 frames for 10 s at 60 fps,
   0 dropped, with each hardware encoder.
===
7. "Test the engine's recording": file plays, 600 frames for 10 s at 60 fps,
   0 dropped, with each hardware encoder — and says "zero-copy: …" on
   NVIDIA, Intel and AMD (the GPU's encoder load in Task Manager, the
   engine's read-back time near zero); a 2-hour stream at 6 Mb/s with
   zero-copy, no drift between picture and sound.
8. Graphics cards: an Optimus laptop with the projector on each GPU, the
   engine automatic and on each card, each output "shown by its display's
   own graphics card" on and off (latency, late frames, the dialog's window
   list); a desktop with two cards.
9. HDR: an HDR10 display in HDR mode with an output in HDR (white at 203
   nits matches an SDR window beside it; graphics unchanged), an HDR10 and an
   HLG file, an HDR capture card in P010 (tone mapped, no clipping, no hue
   shifts); the same with the display in SDR (stays SDR).
@@@
  to be run on the Windows matrix of §6.) Left: zero-copy encode (D3D
  texture → NVENC/AMF/QSV), per-output adapters, HDR (designs above), and
  Unified as the default.
===
  to be run on the Windows matrix of §6.) Then also: zero-copy encode (the
  engine's D3D12 texture shared with D3D11 and the vendor's Media Foundation
  hardware encoder, read-back fallback), the engine's graphics card and
  outputs shown by their display's own card, HDR outputs (HDR10/scRGB) and
  HDR inputs tone-mapped, a camera as a slide fading in, the vertical
  version's shadow, graphics inputs in the multiview while not on air, the
  replay's toggle following its encoder. (D3D12/D3D11/Media Foundation,
  DXGI's displays and HDR swap chains compile-checked; to be run on items
  7 – 9 of §6.) Left: running the Windows matrix, and Unified as the default.
@@@
| Encoder read-back       | 3.1 MB/frame NV12 = 190 MB/s download (RGBA was 8.3 MB = 500 MB/s); pipelined (two buffers, one frame late), so no stall | Done in Phase 2: each screen feed is converted to NV12 on the GPU (`fs_nv12`, BT.709 limited, tagged so) and read back as such; hardware encoders take NV12 as it is. Phase 3: hand the D3D texture to NVENC/AMF/QSV directly.                                    |
===
| Encoder read-back       | 3.1 MB/frame NV12 = 190 MB/s download (RGBA was 8.3 MB = 500 MB/s); pipelined (two buffers, one frame late), so no stall | Done in Phase 2: each screen feed is converted to NV12 on the GPU (`fs_nv12`, BT.709 limited, tagged so) and read back as such; hardware encoders take NV12 as it is. Phase 3 (Windows): none at all with zero-copy — the texture goes to the card's encoder (a GPU copy and an NV12 conversion on the card). |
@@@
| HDR displays            | An 8-bit swapchain on an HDR desktop looks washed out or dim.                                                                                                                           | DWM composites SDR swapchains correctly on HDR desktops (sRGB → scRGB); we use `Bgra8Unorm`. A real HDR output (scRGB/`Rgba16Float`) is Phase 3.                                                                                                                                                                                                       |
| Hybrid-GPU laptops      | The engine picks the NVIDIA GPU (HighPerformance) while the projector's HDMI port hangs off the Intel GPU: every present is a cross-adapter copy; or Windows forces the integrated GPU. | wgpu reports the adapter (shown in the Engine dialog); test matrix includes Optimus/Advanced-Optimus laptops; Phase 2: pick the adapter that drives the most output displays (DXGI `EnumOutputs`), fall back to a per-output adapter.                                                                                                                  |
===
| HDR displays            | An 8-bit swapchain on an HDR desktop looks washed out or dim.                                                                                                                           | DWM composites SDR swapchains correctly on HDR desktops (sRGB → scRGB); we use `Bgra8Unorm` by default. Phase 3: per output, an HDR10 (PQ) or scRGB swap chain with SDR white at a set level (203 nits) when the display is in HDR.                                                                                                                   |
| Hybrid-GPU laptops      | The engine picks the NVIDIA GPU (HighPerformance) while the projector's HDMI port hangs off the Intel GPU: every present is a cross-adapter copy; or Windows forces the integrated GPU. | wgpu reports the adapter (shown in the Engine dialog, with why). Phase 3: the card can be chosen in Settings → Engine, and each output can be shown by its display's own card (DXGI `EnumOutputs`; the engine copies the picture across, one frame late). Test matrix includes Optimus/Advanced-Optimus laptops.                                         |
@@@
| Instant replay   | `replay.rs`, `src-tauri/src/live.rs` (`live_engine_replay_*`)
===
| Zero-copy encode | `zerocopy.rs`, `zerocopy_win.rs`                                                                                                       | The screen feed's texture handed to the card's Media Foundation encoder (D3D12 → D3D11 shared texture and fences); read-back fallback; the route reported (below). |
| Graphics cards   | `adapters.rs`                                                                                                                          | The engine's card (automatic: high performance, or chosen); outputs shown by their display's own card (`Bridge`). |
| HDR              | `hdr.rs`, `hdr.wgsl`, `gpu.rs` (`OutColor`)                                                                                            | HDR10/scRGB output windows; HDR10/HLG files and P010 cameras tone-mapped into the SDR picture. |
| Instant replay   | `replay.rs`, `src-tauri/src/live.rs` (`live_engine_replay_*`)
