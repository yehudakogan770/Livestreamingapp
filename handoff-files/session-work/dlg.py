p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/broadcast/BroadcastDialog.tsx'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("""import type { CaptureSettings, Destination, EngineClient, Quality } from '../engine/client';""",
"""import type { CaptureSettings, CaptureStatus, Destination, EncoderChoice, EngineClient, Quality } from '../engine/client';""")
rep("""const AUDIO = [""","""/** The encoders the operator can choose, and the FFmpeg names that mean each one works here. */
export const ENCODERS: { id: EncoderChoice; name: string; needs: string | null }[] = [
  { id: 'auto', name: 'Automatic — the graphics card if it can, else the processor', needs: null },
  { id: 'nvidia', name: 'NVIDIA (NVENC)', needs: 'h264_nvenc' },
  { id: 'intel', name: 'Intel (Quick Sync)', needs: 'h264_qsv' },
  { id: 'amd', name: 'AMD (AMF)', needs: 'h264_amf' },
  { id: 'software', name: 'Software (the processor, x264)', needs: null },
];

/** What the start-up check found, in words. */
export function encodersFound(status: Pick<CaptureStatus, 'hwEncoders' | 'hwChecked' | 'hwFailed'>): string {
  if (!status.hwChecked) return 'Checking this computer’s graphics card…';
  const found = ENCODERS.filter((e) => e.needs && status.hwEncoders?.includes(e.needs)).map((e) => e.name);
  const failed = (status.hwFailed ?? []).map((f) => ({ nvenc: 'NVIDIA', qsv: 'Intel', amf: 'AMD', software: 'Software' })[f]);
  const text = found.length ? `Found here: ${found.join(', ')}.` : 'No graphics-card encoder works here, so the processor does the encoding.';
  return failed.length ? `${text} Stopped working this time (not used until Lumora restarts): ${failed.join(', ')}.` : text;
}

const AUDIO = [""")
rep("""  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void client.captureFolder().then(setFolder, () => {});
  }, [client]);""","""  const [problem, setProblem] = useState<string | null>(null);
  // The cameras and microphones that can be recorded on their own.
  const [inputs, setInputs] = useState<{ id: string; name: string; kind: 'camera' | 'microphone' }[]>([]);
  useEffect(() => {
    void client.captureFolder().then(setFolder, () => {});
    void client.getShow().then(
      ({ show }) =>
        setInputs(
          show.sources.flatMap((x) => (x.kind.type === 'camera' || x.kind.type === 'microphone' ? [{ id: x.id, name: x.name, kind: x.kind.type }] : [])),
        ),
      () => {},
    );
  }, [client]);""")
rep("""            <label className="check">
              <input type="checkbox" checked={draft.iso ?? true} onChange={(e) => set({ iso: e.target.checked })} /> Also record each camera and microphone to
              its own file (to edit the whole event afterwards in Lumora Studio)
            </label>""","""            <label className="check">
              <input type="checkbox" checked={draft.iso ?? true} onChange={(e) => set({ iso: e.target.checked })} /> Also record each camera and microphone to
              its own file (to edit the whole event afterwards in Lumora Studio)
            </label>
            {(draft.iso ?? true) && inputs.length > 0 && (
              <div className="bcd__isos">
                {inputs.map((x) => {
                  const skip = draft.isoSkip ?? [];
                  return (
                    <label key={x.id} className="check">
                      <input
                        type="checkbox"
                        checked={!skip.includes(x.id)}
                        onChange={(e) => set({ isoSkip: e.target.checked ? skip.filter((id) => id !== x.id) : [...skip, x.id] })}
                      />{' '}
                      {x.name} {x.kind === 'microphone' ? '(sound)' : ''}
                    </label>
                  );
                })}
                <label className="field">
                  <span className="field__label">Bitrate of each camera’s own file</span>
                  <select value={draft.isoKbps ?? 8000} onChange={(e) => set({ isoKbps: Number(e.target.value) })}>
                    {[4000, 8000, 12000, 20000].map((k) => (
                      <option key={k} value={k}>
                        {k / 1000} Mbps{k === 8000 ? ' — recommended for 1080p cameras' : k === 20000 ? ' — 4K cameras' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="field__note">
                    Each file starts on the same clock as the main recording, so Lumora Studio lines them up by itself. The cameras are encoded by the app’s own
                    encoder (the graphics card where it can).
                  </span>
                </label>
              </div>
            )}""")
rep("""            {running && <p className="field__note">Quality changes apply the next time recording or streaming starts.</p>}
          </section>""","""            <div className="bcd__row">
              <label className="field bcd__grow">
                <span className="field__label">Stream picture</span>
                <select
                  value={draft.streamQuality ?? ''}
                  onChange={(e) => set({ streamQuality: (e.target.value || null) as Quality | null })}
                  disabled={draft.quality === 'vertical'}
                >
                  <option value="">Same as the recording</option>
                  {(Object.keys(QUALITIES) as Quality[])
                    .filter((q) => q !== 'vertical' && q !== draft.quality && QUALITIES[q].height <= QUALITIES[draft.quality].height)
                    .map((q) => (
                      <option key={q} value={q}>
                        {QUALITIES[q].name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field bcd__grow">
                <span className="field__label">Stream bitrate</span>
                <select value={draft.streamKbps ?? ''} onChange={(e) => set({ streamKbps: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Same as the recording</option>
                  {BITRATES.map((r) => (
                    <option key={r.kbps} value={r.kbps}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="field__note">
              For example, record in 4K and stream at 1080p: the picture is drawn once and FFmpeg makes the smaller stream from it.
            </span>
            {running && <p className="field__note">Quality changes apply the next time recording or streaming starts.</p>}
          </section>

          <section className="bcd__section">
            <h3>Encoder</h3>
            <div className="bcd__row">
              <label className="field bcd__grow">
                <span className="field__label">Encoder</span>
                <select value={draft.encoder ?? 'auto'} onChange={(e) => set({ encoder: e.target.value as EncoderChoice })}>
                  {ENCODERS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field bcd__grow">
                <span className="field__label">Speed or quality</span>
                <select value={draft.preset ?? 'balanced'} onChange={(e) => set({ preset: e.target.value as CaptureSettings['preset'] })}>
                  <option value="speed">Speed (lightest on the computer)</option>
                  <option value="balanced">Balanced — recommended</option>
                  <option value="quality">Quality (heavier)</option>
                </select>
              </label>
            </div>
            <span className="field__note">{encodersFound(b.status)}</span>
            <label className="check">
              <input type="checkbox" checked={draft.recordEncode ?? false} onChange={(e) => set({ recordEncode: e.target.checked })} /> Encode recordings with
              this encoder at constant quality (off: the app’s own encode is saved as it is — the safest choice)
            </label>
            {draft.recordEncode && (
              <label className="field">
                <span className="field__label">Recording format</span>
                <select value={draft.recordCodec ?? 'h264'} onChange={(e) => set({ recordCodec: e.target.value as 'h264' | 'hevc' })}>
                  <option value="h264">H.264 — plays everywhere</option>
                  <option value="hevc">HEVC (H.265) — smaller files, needs a graphics card that can make it</option>
                </select>
              </label>
            )}
            <span className="field__note">
              Streams always use a constant bitrate with a keyframe every 2 seconds. If the graphics card’s encoder stops during the event, Lumora switches to
              the processor by itself and carries on (a recording goes on in a new file). See Help → Encoders and quality.
            </span>
          </section>""")
rep("""                    <span className="field__note">Stream key: {service.keyHelp}. It stays on this computer.</span>""","""                    <span className="field__note">Stream key: {service.keyHelp}. It stays on this computer.</span>
                    <label className="field">
                      <span className="field__label">Bitrate for {d.name || 'this destination'}</span>
                      <select
                        value={d.videoKbps ?? ''}
                        onChange={(e) => setDest(d.id, { videoKbps: e.target.value ? Number(e.target.value) : null })}
                        aria-label={`Bitrate for ${d.name}`}
                      >
                        <option value="">Same as the stream</option>
                        {BITRATES.map((r) => (
                          <option key={r.kbps} value={r.kbps}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>""")
open(p,'w').write(s)
