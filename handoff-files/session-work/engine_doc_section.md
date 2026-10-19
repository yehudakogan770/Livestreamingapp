### Zero-copy encoding (Phase 3)

Before, each screen feed was converted to NV12 on the GPU, read back (one
frame late, 3.1 MB a frame at 1080p) and piped to FFmpeg, which handed it to
NVENC, Quick Sync or AMF — ≈190 MB/s across the bus and the pipe at 1080p60
for one feed. Now (`zerocopy.rs`, `zerocopy_win.rs`) the picture goes to the
graphics card's own encoder **as a texture**:

- **The path chosen: the vendors' Media Foundation hardware encoders.**
  NVIDIA, Intel and AMD each install a hardware H.264/HEVC encoder MFT with
  their display driver (`MFTEnumEx(MFT_ENUM_FLAG_HARDWARE)`); it takes
  Direct3D 11 textures through `IMFDXGIDeviceManager`. Nothing has to be
  shipped: linking libavcodec with D3D11 frames would mean shipping FFmpeg's
  shared libraries next to the app (CI bundles only `ffmpeg.exe`, the static
  "essentials" build) and a C build step; the three vendor SDKs (nvEncodeAPI,
  AMF, oneVPL) are three APIs to keep up with. The MFTs are what Windows' own
  camera app, Teams and the WebView's MediaRecorder use, so they are the most
  likely to work on an event PC, and CI is unchanged.
- **The hand-over.** Each feed gets a ring of three textures created by the
  engine's own Direct3D 12 device as shared resources (`D3D12_HEAP_FLAG_SHARED`,
  simultaneous access, so they decay to COMMON after every submit and D3D11
  can read them), wrapped as wgpu textures (`create_texture_from_hal`), and
  opened on a Direct3D 11 device made on the **same** card (matched by LUID).
  Two shared `ID3D12Fence`s are opened on D3D11 (`OpenSharedFence`): each frame
  the engine copies the feed's picture into the next ring texture — after a
  GPU-side wait on `free` for that texture (`wgpu-hal`'s `add_wait_fence`) —
  and signals `drawn` after the copy (`add_signal_fence`). The encoder's
  thread (all COM objects live there) waits on `drawn` on the GPU
  (`ID3D11DeviceContext4::Wait`), turns the RGBA texture into NV12 with the
  card's video processor (BT.709, limited range: the colors the read-back
  path's `fs_nv12` makes; `VideoProcessorSetOutputColorSpace1`), signals
  `free`, and gives the NV12 texture to the encoder
  (`MFCreateDXGISurfaceBuffer`, asynchronous MFTs driven by their
  `METransformNeedInput` / `HaveOutput` events, synchronous ones too). No
  pixel crosses to the processor and the engine never waits.
- **Settings are the app's** (`encode.rs` → `live.rs: zero_copy`): the
  operator's encoder choice picks the vendor (NVENC → NVIDIA's MFT, Quick Sync
  → Intel's, AMF → AMD's), constant bitrate for streams or constant quality
  with a ceiling, the speed preset (`CODECAPI_AVEncCommonQualityVsSpeed`), a
  keyframe every 2 seconds (`CODECAPI_AVEncMPVGOPSize`; the replay's: one per
  3-second piece), no B-frames, low-latency mode, High profile, BT.709 tags.
  The processor encoder (x264) keeps the read-back path.
- **Into the same sessions.** The encoded elementary stream is written to the
  feed's FFmpeg, which now copies the picture (`-f h264 … -c:v copy`,
  `encoder::encoded_input`) and adds the sound as before, so files,
  destinations, reconnects, backups and NDI are unchanged. Parameter sets
  kept out of the stream by an encoder are put in front of the first frame
  (`MF_MT_MPEG_SEQUENCE_HEADER`).
- **Feature detection and fallback.** The engine on Vulkan/GL (not D3D12), no
  MFT of the chosen vendor on the engine's card, a video processor that can't
  make NV12, settings or sizes the encoder refuses, or no answer within 10 s:
  the feed reads back as before, and its route says why. An encoder that fails
  mid-stream ends the picture with its reason (the session starts again as for
  any lost encoder) and zero-copy is not tried again until Lumora restarts
  (`zerocopy::broken`, shown in the Engine dialog); a lost graphics device
  ends it too (its textures went with the device) without that.
  `LUMORA_NO_ZERO_COPY=1` turns it off.
- **Reported.** Each screen feed has a route (`FeedInfo.route`: "zero-copy:
  NVIDIA NVENC H.264 on … (Media Foundation, …)" or "read back as NV12 to
  FFmpeg (why)"), shown in the Engine dialog, the engine's test recording
  ("Test the engine's recording") and the test event's report.
- **Tested here** with a stand-in (`zerocopy::standin`): the same ring of
  textures and GPU copies, read back and encoded by x264 in a second FFmpeg —
  the engine's side, the frames owed and the encoded picture into the file are
  checked end to end (`zero_copy_hands_the_picture_over_on_the_gpu…`), with
  the fallback (`zero_copy_that_cannot_open_reads_back_and_says_why`). The
  D3D12/D3D11/Media Foundation part compiles for Windows from Linux and needs
  NVIDIA, Intel and AMD cards to run.

### Graphics cards: the engine's and each output's (Phase 3)

- **The engine's card** (Settings → Engine → Graphics card): automatic is the
  high-performance card (`PowerPreference::HighPerformance`: on a hybrid
  laptop the NVIDIA/AMD one; Windows' per-app graphics setting still wins), or
  one chosen from the list (`adapters::cards`: every card with the displays it
  drives, from DXGI `EnumOutputs`). The choice is kept in `live-engine.json`;
  changing it starts the engine again on that card (its windows reopen there,
  graphics and person masks are sent again; refused while recording,
  streaming or keeping replays). A chosen card that is gone falls back to the
  high-performance one, and says so.
- **Each output window** (Live, Back, Monitor, multiview) is shown by the
  engine's card by default — on a hybrid laptop with the projector on the other
  GPU, Windows copies each frame across. Per output, "Shown by its display's
  own graphics card" makes the engine do it instead (`adapters::Bridge`): a
  small compositor on the card that drives that display (found by the
  display's rectangle), the screen read back one frame late on the engine's
  card (pipelined, never waiting) and uploaded there, and the window presented
  and flipped on its own card. The Engine dialog and the test event list each
  window's card, whether it was copied and its colors.

### HDR (Phase 3)

- **HDR outputs.** Per output, "HDR when its display shows HDR" (default off:
  SDR). When the display reports HDR (wgpu's `display_hdr_info`, from DXGI)
  the window's swap chain becomes HDR10 (`Rgb10a2Unorm`, BT.2100 PQ) or, where
  only that is offered, scRGB (`Rgba16Float`, linear); the present pass
  (`compose.wgsl: to_hdr`) puts the engine's SDR picture and graphics at SDR
  white — 203 nits (BT.2408) by default, set in the dialog — instead of
  leaving it to Windows' SDR brightness slider; BT.709 colors are placed in
  BT.2020 unchanged. A display that isn't in HDR keeps SDR.
- **HDR inputs.** A video file in HDR10 (PQ) or HLG (`ffprobe`'s
  `color_transfer`) is decoded as 10-bit RGB (`x2bgr10le`) instead of being
  clipped by FFmpeg; a camera or capture card whose mode is P010 with a PQ or
  HLG transfer function is read as P010. On the GPU (`hdr.wgsl`, once per new
  frame, like NV12) the signal becomes light (PQ absolute; HLG on BT.2100's
  1000-nit reference display), BT.2020 becomes BT.709, diffuse white (203
  nits) lands at the top of SDR and highlights roll off smoothly above 75 %
  (a soft shoulder, never a hard clip). The same maths in `hdr.rs` makes the
  vision worker's small frames, and the GPU test holds the shader to it.
- **Still SDR inside.** The engine composites in 8-bit SDR (BT.709,
  sRGB-encoded, as the web canvases), so an HDR input on an HDR output is
  tone-mapped down and placed back at SDR white: no highlights above SDR white
  on HDR displays and in recordings. Keeping HDR end to end would need 16-bit
  float screen targets and an HDR10 encode (P010, BT.2020/PQ tags).

### What Unified (beta) does not do yet

Everything in the Standard engine is in Unified. Listed in the Engine dialog
are the parts still to be checked on Windows hardware (each falls back by
itself, and the dialog and the test event say which way was used):

- zero-copy encoding on NVIDIA, Intel and AMD cards (else the read-back path);
- the engine's card choice and outputs shown by their display's own card, on
  hybrid laptops and two-card desktops (else the engine's card, Windows copying);
- HDR outputs on HDR displays and HDR cameras and capture cards (else SDR).
