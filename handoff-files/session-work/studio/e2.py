p='editor/app/src/ui/Speech.tsx'
s=open(p).read()
s=s.replace("""import { captionRange, spansToTranscribe, Transcriber, withTranscripts, type SpeechModel, type SpeechProgress } from '../speech/transcribe';""","""import { captionRange, spansToTranscribe, Transcriber, withTranscripts, type SpeechModel, type SpeechProgress } from '../speech/transcribe';
import { findSpeakers, withVoices } from '../speech/voices';""")
# dialog option
s=s.replace("""  const [captions, setCaptions] = useState(true);
  const [state, setState]""","""  const [captions, setCaptions] = useState(true);
  const [voices, setVoices] = useState(false);
  const [state, setState]""",1)
s=s.replace("""      const found = await t.run(media, spans);
      const range = chosen ? captionRange(current(doc.project), chosen) : null;
      doc.edit(
        (p) => {
          const q = withTranscripts(p, found);
          return captions ? makeCaptions(q, range) : q;
        },
        captions ? 'Transcribe and make captions' : 'Transcribe',
      );""","""      const found = await t.run(media, spans);
      const range = chosen ? captionRange(current(doc.project), chosen) : null;
      // Speakers sharing a microphone, told apart by their voices.
      let heard = new Map<string, number[] | null>();
      if (voices) {
        const withWords = withTranscripts(doc.project, found).media.filter((m) => found.has(m.id));
        heard = await findSpeakers(withWords, native.speechAudio, (done, name) =>
          setState({ stage: 'listening', done, message: `Telling the voices apart in ${name}…` }),
        );
      }
      doc.edit(
        (p) => {
          let q = withTranscripts(p, found);
          for (const [id, v] of heard) q = withVoices(q, id, v);
          return captions ? makeCaptions(q, range) : q;
        },
        captions ? 'Transcribe and make captions' : 'Transcribe',
      );""")
s=s.replace("""            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Make captions on the timeline
          </label>""","""            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Make captions on the timeline
          </label>
          <label className="check form__check" title="For an interview or panel recorded on one microphone: each person is told apart by the sound of their voice">
            <input type="checkbox" checked={voices} onChange={(e) => setVoices(e.target.checked)} /> Tell speakers apart by their voices (several people on one microphone)
          </label>""")
# panel
s=s.replace("""  const voices = useMemo(() => new Set(words.map((w) => w.media)).size, [words]);""","""  const voices = useMemo(() => new Set(words.map((w) => w.who)).size, [words]);
  const [finding, setFinding] = useState<string | null>(null);
  /** Tell apart the voices in every transcribed file heard in the sequence (people sharing a microphone). */
  const findVoices = async () => {
    const ids = new Set(words.map((w) => w.media));
    const media = doc.project.media.filter((m) => ids.has(m.id));
    setFinding('Telling the voices apart…');
    try {
      const heard = await findSpeakers(media, native.speechAudio, (done, name) => setFinding(`Telling the voices apart in ${name}… ${Math.round(done * 100)}%`));
      doc.edit((p) => [...heard].reduce((q, [id, v]) => withVoices(q, id, v), p), 'Find speakers');
      const found = [...heard.values()].reduce((a, v) => a + (v ? Math.max(...v) + 1 : 0), 0);
      ui.note(found ? `${found} speakers told apart by their voices: click a name in the transcript to change it` : 'One voice in each recording: nothing to tell apart');
    } catch (e) {
      ui.note(`Could not tell the voices apart: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFinding(null);
    }
  };""")
s=s.replace("""          const who = voices > 1 && (!before || before.media !== first.media) ? first.media : null;""","""          const who = voices > 1 && (!before || before.who !== first.who) ? first.who : null;""")
s=s.replace("""        <button type="button" className="btn btn--sm" onClick={() => ui.set({ dialog: 'transcribe' })}>
          Transcribe…
        </button>
      </div>
      <div
        ref={box}""","""        <button type="button" className="btn btn--sm" onClick={() => ui.set({ dialog: 'transcribe' })}>
          Transcribe…
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!inApp() || finding !== null}
          title="Several people on one microphone: tell them apart by the sound of their voices (on this computer)"
          onClick={() => void findVoices()}
        >
          {finding ?? 'Find speakers'}
        </button>
      </div>
      <div
        ref={box}""")
open(p,'w').write(s)
