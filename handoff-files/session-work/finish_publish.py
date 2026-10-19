import sys
root = sys.argv[1]
p = root + '/editor/app/src/export/renderQueue.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


rep("""      if (j) {
        this.onFinished(j);""", """      if (j) {
        this.onFinished(j);
        const then = this.then.get(j.id);
        this.then.delete(j.id);
        if (then && j.status === 'done') then(j);""")
rep("""  /** Told when an export finishes (or fails). */
  onFinished: (job: QueueJob) => void = () => {};""", """  /** Told when an export finishes (or fails). */
  onFinished: (job: QueueJob) => void = () => {};
  /** What to do when a particular export has finished well (e.g. publish it). */
  private then = new Map<string, (job: QueueJob) => void>();

  /** Run `f` once the export `id` has finished well. */
  whenDone(id: string, f: (job: QueueJob) => void) {
    this.then.set(id, f);
  }""")
open(p, 'w').write(s)

p = root + '/editor/app/src/smart/FinishDialog.tsx'
s = open(p).read()
rep("""          renderQueue.add(made, seq.name, choice.preset.name);
        }""", """          const id = renderQueue.add(made, seq.name, choice.preset.name);
          // The event itself goes on to YouTube when it is exported (only you can see it until you change that).
          if (upload && seq.id === res.film) renderQueue.whenDone(id, () => void publishFilm(id, ui));
        }""")
rep("""  const [queue, setQueue] = useState(inApp());""", """  const [queue, setQueue] = useState(inApp());
  const [upload, setUpload] = useState(false);
  const [yt, setYt] = useState<YoutubeInfo | null>(null);
  useEffect(() => {
    let live = true;
    void youtube
      .info()
      .then((i) => live && setYt(i))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);""")
rep("""          {job.problem && <p className="form__problem">{job.problem}</p>}""", """          {queue && yt?.connected && (
            <div className="form__row">
              <span>YouTube</span>
              <label className="check">
                <input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} /> Publish the event to {yt.channel || 'the channel'} when it
                is exported (only you can see it until you change that)
              </label>
            </div>
          )}
          {job.problem && <p className="form__problem">{job.problem}</p>}""")
rep("import { Progress, useJob } from './job';", """import { Progress, useJob } from './job';
import { publish, startingDescription, youtube, type YoutubeInfo } from '../publish/youtube';""")
s += '''
/** Publish a finished export of the event: its name, chapters, captions file and thumbnail, only for the channel's owner at first. */
async function publishFilm(job: string, ui: Ui) {
  const src = renderQueue.publishSource(job);
  if (!src) return;
  try {
    const r = await publish(
      job,
      src.path,
      { title: src.title.slice(0, 100), description: startingDescription(src.markers, src.fps, src.range), tags: [], category: '22', visibility: 'private', madeForKids: false },
      { thumbnail: src.thumbnail, captions: src.srt ? { path: src.srt, language: 'en', name: 'English' } : null },
    );
    ui.note(`The event is on YouTube (only you can see it): ${r.url}`);
  } catch (e) {
    ui.note(`The event couldn’t be published: ${e instanceof Error ? e.message : String(e)} Publish it from the render queue.`);
  }
}
'''
open(p, 'w').write(s)
