root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/extras/ExtrasTools.tsx', [
("export type ExtrasTool = 'colormatch' | 'music' | 'search' | 'translate' | 'chapters' | 'voice';","export type ExtrasTool = 'colormatch' | 'music' | 'search' | 'translate' | 'chapters' | 'voice' | 'broll';"),
("""    { label: 'Media search…', disabled: p.media.length === 0, run: () => openExtras('search') },
    'sep',""","""    { label: 'Media search…', disabled: p.media.length === 0, run: () => openExtras('search') },
    {
      label: 'B-roll from your media…',
      disabled: !p.media.some((m) => m.transcript?.words.length) || !p.media.some((m) => m.hasVideo),
      run: () => openExtras('broll'),
    },
    'sep',"""),
("""  if (t === 'voice') return <DuckingDialog doc={doc} ui={ui} onClose={close} />;""","""  if (t === 'voice') return <DuckingDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'broll') return <BrollDialog doc={doc} engine={engine} ui={ui} onClose={close} />;"""),
("""import { indexPictures, knownLooks } from './searchjob';""","""import { indexPictures, knownLooks } from './searchjob';
import { BROLL_DEFAULTS, placeBroll, planBroll, type BrollPick } from './broll';"""),
("""// ---------------------------------------------------------------------------
// Caption translation.""","""// ---------------------------------------------------------------------------
// B-roll from your own media.

function BrollDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const [looks, setLooks] = useState<Map<string, LookIndex>>(new Map());
  const [longest, setLongest] = useState(BROLL_DEFAULTS.longest);
  const [gap, setGap] = useState(BROLL_DEFAULTS.gap);
  const [off, setOff] = useState<Set<number>>(new Set());
  const job = useJob();
  useEffect(() => {
    void knownLooks(project.media).then(setLooks);
  }, [project.media.length]);
  const picks: BrollPick[] = useMemo(() => planBroll(project, s, looks, { ...BROLL_DEFAULTS, longest, gap }), [project, s, looks, longest, gap]);
  useEffect(() => setOff(new Set()), [picks]);
  const visual = project.media.filter((m) => m.hasVideo);
  const indexed = visual.filter((m) => looks.has(m.id)).length;
  const name = (id: string) => project.media.find((m) => m.id === id)?.name ?? id;
  const chosen = picks.filter((_, i) => !off.has(i));
  const look = async () => {
    const r = await job.run((j) => indexPictures(project.media, j, false));
    if (r) setLooks(r.looks);
  };
  return (
    <Modal title="B-roll from your media" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <p className="insp__note">
            While someone talks about a thing, a shot of your own that shows it goes over them, on a new B-roll track. What is said comes from the transcript;
            what each shot shows comes from looking at the pictures on this computer ({indexed} of {visual.length} picture files looked at).
          </p>
          <div className="form__row">
            <span>Each shot</span>
            <Choice
              value={longest}
              options={[
                [3, 'Up to 3 s'],
                [5, 'Up to 5 s'],
                [8, 'Up to 8 s'],
              ]}
              onChange={setLongest}
              label="Longest shot"
            />
          </div>
          <div className="form__row">
            <span>Between shots</span>
            <Choice
              value={gap}
              options={[
                [2, 'At least 2 s'],
                [4, 'At least 4 s'],
                [8, 'At least 8 s'],
              ]}
              onChange={setGap}
              label="Time between shots"
            />
          </div>
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <ul className="smart__list extras__hits">
            {picks.length === 0 && (
              <li className="smart__empty">
                {indexed < visual.length ? 'Look at the pictures first, so Lumora Studio knows what each shot shows.' : 'No shot shows what is talked about.'}
              </li>
            )}
            {picks.map((k, i) => (
              <li key={`${k.from}-${k.media}`} className={off.has(i) ? '' : 'is-on'}>
                <input
                  type="checkbox"
                  checked={!off.has(i)}
                  aria-label={`Use ${name(k.media)} at ${secs(k.from / fps)}`}
                  onChange={() =>
                    setOff((was) => {
                      const next = new Set(was);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
                <button
                  type="button"
                  className="smart__time"
                  onClick={() => {
                    engine.pause();
                    engine.seek(k.from);
                  }}
                >
                  {secs(k.from / fps)}
                </button>
                <span className="smart__tag">{k.label}</span>
                <span className="smart__why" title={k.said}>
                  <b>{name(k.media)}</b> over “{k.said.length > 70 ? `${k.said.slice(0, 70)}…` : k.said}”
                </span>
              </li>
            ))}
          </ul>
          <div className="form__foot">
            <button type="button" className="btn" disabled={!visual.length || indexed === visual.length} onClick={() => void look()}>
              Look at pictures
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!chosen.length}
              onClick={() => {
                const r = placeBroll(doc.project, chosen);
                doc.edit(() => r.project, 'B-roll from your media');
                ui.note(`${r.count} B-roll shot${r.count === 1 ? '' : 's'} on a new track. Each is an ordinary clip; Undo takes them all away.`);
                onClose();
              }}
            >
              Put {chosen.length || ''} on the timeline
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Caption translation."""),
])
