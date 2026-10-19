p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/testevent/verdict.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("""  disk: 'Disk writes: src-tauri/src/capture.rs (the writer thread and its queue, MAX_QUEUED).',""","""  disk: 'Disk writes: src-tauri/src/capture.rs (the writer thread and its queue, MAX_QUEUED).',
  encoder: 'Encoders: src-tauri/src/encode.rs (choice, arguments, failure words) and capture.rs (the fallback).',""")
rep("""  // ----- the disk -----
  if (m.diskMBps !== null) {""","""  // ----- the encoders -----
  if (m.encoders?.failed.length)
    add(
      'problem',
      'Encoder',
      'The graphics card’s encoder stopped during the test',
      `${m.encoders.failed.join(', ')} failed; the processor took over.`,
      'Update the graphics driver, then run the test again. Until then, choose Software in Settings → Recording and streaming → Encoder.',
      WHERE.encoder,
    );
  else if (m.encoders?.stream || m.encoders?.recording)
    advice.push(`Encoders used: recording — ${m.encoders.recording ?? 'not tested'}; stream — ${m.encoders.stream ?? 'not tested'}.`);

  // ----- the disk -----
  if (m.diskMBps !== null) {""")
open(p,'w').write(s)
