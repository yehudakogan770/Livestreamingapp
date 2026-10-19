import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/publish/youtube.ts', [
    ("""export interface Published {
  id: string;
  url: string;
  notes: string[];
}""", """export interface Published {
  /** YouTube's video id (none for Vimeo). */
  id?: string;
  url: string;
  notes: string[];
}

export interface VimeoInfo {
  connected: boolean;
  name: string;
}

/** Who can see a Vimeo video. */
export type VimeoWho = 'anybody' | 'unlisted' | 'nobody';

export const vimeo = {
  info: (): Promise<VimeoInfo> => (inApp() ? invoke<VimeoInfo>('vimeo_info') : Promise.resolve({ connected: false, name: '' })),
  connect: (token: string) => invoke<VimeoInfo>('vimeo_connect', { token }),
  disconnect: () => invoke<VimeoInfo>('vimeo_disconnect'),
  open: (url: string) => invoke<void>('vimeo_open', { url }),
};"""),
    ("""export interface Upload {
  /** The render queue job it came from. */
  job: string;""", """export interface Upload {
  /** The render queue job it came from. */
  job: string;
  /** Where it goes. */
  dest: 'youtube' | 'vimeo';"""),
    ("""  uploads = { ...uploads, [job]: { job, title: details.title, stage: 'starting', bytes: 0, total: 0 } };""",
     """  uploads = { ...uploads, [job]: { job, dest: 'youtube', title: details.title, stage: 'starting', bytes: 0, total: 0 } };"""),
    ("""export function useUploads(): Record<string, Upload> {""", """/** Send a finished film to Vimeo (the same way: it keeps going, and the queue shows how far it is). */
export async function publishVimeo(
  job: string,
  path: string,
  details: { title: string; description: string; who: VimeoWho },
  captions: { path: string; language: string; name: string } | null = null,
): Promise<Published> {
  listenOnce();
  uploads = { ...uploads, [job]: { job, dest: 'vimeo', title: details.title, stage: 'starting', bytes: 0, total: 0 } };
  changed();
  try {
    const result = await invoke<Published>('vimeo_upload', { job, path, details, captions });
    put(job, { stage: 'done', result, bytes: uploads[job]?.total ?? 0 });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    put(job, { stage: /stopped/i.test(error) ? 'stopped' : 'failed', error });
    throw new Error(error);
  }
}

export function useUploads(): Record<string, Upload> {"""),
])

edit('editor/app/src/ui/Publish.tsx', [
    ("""// Render queue > Publish to YouTube: the channel, the video's details
// (title, description with chapters, tags, category, who can see it, made for
// kids), its thumbnail and captions, and the upload with its progress. The
// upload keeps going if this window is closed; the queue shows how far it is.""",
     """// Render queue > Publish: to YouTube (the channel, the video's details:
// title, description with chapters, tags, category, who can see it, made for
// kids; its thumbnail and captions) or to Vimeo (an access token, title,
// description, who can see it, captions), and the upload with its progress.
// The upload keeps going if this window is closed; the queue shows how far it is."""),
    ("""  publish,
  startingDescription,
  useUploads,
  youtube,
  type VideoDetails,
  type Visibility,
  type YoutubeInfo,
} from '../publish/youtube';""", """  publish,
  publishVimeo,
  startingDescription,
  useUploads,
  vimeo,
  youtube,
  type VideoDetails,
  type VimeoInfo,
  type Visibility,
  type YoutubeInfo,
} from '../publish/youtube';"""),
    ("""  const [info, setInfo] = useState<YoutubeInfo | null>(null);""", """  const [info, setInfo] = useState<YoutubeInfo | null>(null);
  const [dest, setDest] = useState<'youtube' | 'vimeo'>('youtube');
  const [vInfo, setVInfo] = useState<VimeoInfo | null>(null);
  const [token, setToken] = useState('');"""),
    ("""    void youtube
      .info()
      .then((i) => live && setInfo(i))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));""", """    void youtube
      .info()
      .then((i) => live && setInfo(i))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));
    void vimeo
      .info()
      .then((i) => live && setVInfo(i))
      .catch(() => undefined);"""),
    ("""      <Modal title="Publish to YouTube" onClose={onClose}>
        <p className="insp__note">Only a finished video export can be published.""", """      <Modal title="Publish" onClose={onClose}>
        <p className="insp__note">Only a finished video export can be published."""),
    ("""  const start = () => {
    setProblem('');
    void publish(job, src.path, details, {""", """  const connectVimeo = async () => {
    setBusy('connect');
    setProblem('');
    try {
      setVInfo(await vimeo.connect(token));
      setToken('');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const captionsFile = caps && src.srt ? { path: src.srt, language, name: language === 'en' ? 'English' : language } : null;
  const start = () => {
    setProblem('');
    if (dest === 'vimeo') {
      const who = d.visibility === 'public' ? 'anybody' : d.visibility === 'unlisted' ? 'unlisted' : 'nobody';
      void publishVimeo(job, src.path, { title: d.title, description: d.description, who }, captionsFile)
        .then((r) => ui.note(`Published to Vimeo: ${r.url}${r.notes.length ? ` (${r.notes.join(' ')})` : ''}`))
        .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
      return;
    }
    void publish(job, src.path, details, {"""),
    ("""    <Modal title="Publish to YouTube" onClose={onClose} wide>
      <div className="form">
        <div className="form__row">
          <span>Channel</span>
          {info === null ? (""", """    <Modal title="Publish" onClose={onClose} wide>
      <div className="form">
        <div className="form__row">
          <span>Where</span>
          <Choice
            value={dest}
            options={[
              ['youtube', 'YouTube'],
              ['vimeo', 'Vimeo'],
            ]}
            onChange={(v) => {
              setDest(v);
              setProblem('');
            }}
            label="Where to publish"
          />
        </div>
        {dest === 'vimeo' ? (
          <div className="form__row">
            <span>Account</span>
            {vInfo?.connected ? (
              <span className="form__pair">
                <b>{vInfo.name || 'Connected'}</b>
                <button type="button" className="linkbtn" disabled={!!running} onClick={() => void vimeo.disconnect().then(setVInfo)}>
                  Disconnect
                </button>
              </span>
            ) : (
              <span className="form__pair">
                <input
                  className="text"
                  type="password"
                  value={token}
                  placeholder="Vimeo access token"
                  aria-label="Vimeo access token"
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button type="button" className="btn" disabled={!token.trim() || busy === 'connect'} onClick={() => void connectVimeo()}>
                  Connect
                </button>
              </span>
            )}
          </div>
        ) : (
        <div className="form__row">
          <span>Channel</span>
          {info === null ? ("""),
    ("""            <button type="button" className="btn" onClick={() => void connect()}>
              Connect a YouTube channel
            </button>
          )}
        </div>""", """            <button type="button" className="btn" onClick={() => void connect()}>
              Connect a YouTube channel
            </button>
          )}
        </div>
        )}
        {dest === 'vimeo' && !vInfo?.connected && (
          <p className="insp__note">
            Make a personal access token at developer.vimeo.com/apps (any app of yours, Generate an access token, with Upload, Edit and Private access),
            then paste it here. It is kept in Windows Credential Manager.
          </p>
        )}"""),
    ("""        <label className="form__row">
          <span>Tags</span>""", """        {dest === 'youtube' && (
        <label className="form__row">
          <span>Tags</span>"""),
    ("""        <label className="form__row">
          <span>Category</span>""", """        )}
        {dest === 'youtube' && (
        <label className="form__row">
          <span>Category</span>"""),
    ("""          </select>
        </label>
        <div className="form__row">
          <span>Who can see it</span>""", """          </select>
        </label>
        )}
        <div className="form__row">
          <span>Who can see it</span>"""),
    ("""              ['private', 'Only me', 'Private: only you, until you change it in YouTube Studio'],""",
     """              ['private', 'Only me', 'Private: only you, until you change it'],"""),
    ("""        <div className="form__row">
          <span>Made for kids</span>""", """        {dest === 'youtube' && (
        <div className="form__row">
          <span>Made for kids</span>"""),
    ("""            onChange={(v) => setD({ ...d, madeForKids: v === 'yes' })}
            label="Made for kids"
          />
        </div>""", """            onChange={(v) => setD({ ...d, madeForKids: v === 'yes' })}
            label="Made for kids"
          />
        </div>
        )}"""),
    ("""            <label className="check">
              <input type="checkbox" checked={thumb} disabled={!src.thumbnail} onChange={(e) => setThumb(e.target.checked)} />{' '}
              {src.thumbnail ? `Thumbnail: ${baseName(src.thumbnail)}` : 'Thumbnail (choose one under Thumbnail when exporting)'}
            </label>""", """            {dest === 'youtube' && (
              <label className="check">
                <input type="checkbox" checked={thumb} disabled={!src.thumbnail} onChange={(e) => setThumb(e.target.checked)} />{' '}
                {src.thumbnail ? `Thumbnail: ${baseName(src.thumbnail)}` : 'Thumbnail (choose one under Thumbnail when exporting)'}
              </label>
            )}"""),
    ("""                  <button type="button" className="linkbtn" onClick={() => up.result && void youtube.watch(up.result.id)}>
                    Watch on YouTube
                  </button>{' '}""", """                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => up.result && void (up.dest === 'vimeo' ? vimeo.open(up.result.url) : up.result.id && youtube.watch(up.result.id))}
                  >
                    {up.dest === 'vimeo' ? 'Watch on Vimeo' : 'Watch on YouTube'}
                  </button>{' '}"""),
    ("""            <button type="button" className="btn btn--primary" disabled={!info?.connected || !!bad || up?.stage === 'done'} onClick={start}>""",
     """            <button
              type="button"
              className="btn btn--primary"
              disabled={!(dest === 'vimeo' ? vInfo?.connected : info?.connected) || !!bad || up?.stage === 'done'}
              onClick={start}
            >"""),
])

edit('editor/app/src/ui/Deliver.tsx', [
    ("""{uploads[j.id]?.stage === 'done' ? 'Published' : uploads[j.id] ? `YouTube ${uploadPct(uploads[j.id])}` : 'Publish to YouTube…'}""",
     """{uploads[j.id]?.stage === 'done'
                      ? 'Published'
                      : uploads[j.id]
                        ? `${uploads[j.id]?.dest === 'vimeo' ? 'Vimeo' : 'YouTube'} ${uploadPct(uploads[j.id])}`
                        : 'Publish…'}"""),
])
