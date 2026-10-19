W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'docs/ENGINE.md'
s=open(p).read()
a="""  shader (port of `chroma.ts`); the picture delay; group opacity; NV12 uploads
  and read-back; files with hardware decode; device-lost recovery."""
assert s.count(a)==1
s=s.replace(a,"""  shader (port of `chroma.ts`); the picture delay; group opacity; NV12 uploads
  and read-back; files with hardware decode; device-lost recovery. (Tested on
  Linux with llvmpipe and FFmpeg; the Windows-only parts — Media Foundation
  NV12, the native windows, WebView2's hidden renderers, D3D12 — compile-checked
  and still to be run on the Windows matrix of §6.) Left for later: background
  removal, blur behind people and auto-framing (the web's person model);
  captions written into the stream picture; instant replay; the Monitor as an
  engine window; graphics on the Next previews; frame-counting timecodes in
  the multiview; a camera behind slides or Pesukim words.""")
open(p,'w').write(s)
