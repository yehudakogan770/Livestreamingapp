import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)

p='titler/src/designer/ExportDialog.tsx'
s=open(p).read()
s+='''
/** A short report after an import or export: what came over differently. */
export function NoticeDialog({ title, lead, items, onClose }: { title: string; lead: string; items: string[]; onClose: () => void }) {
  return (
    <div className="tt-modal" role="dialog" aria-label={title}>
      <div className="tt-modal-box tt-export">
        <h2>{title}</h2>
        <p>{lead}</p>
        {items.length > 0 && (
          <ul className="tt-export-notes">
            {items.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="tt-modal-actions">
          <button className="tt-primary" onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
'''
open(p,'w').write(s)

p='titler/src/designer/Designer.tsx'
rep(p,"import { ExportDialog } from './ExportDialog';","import { ExportDialog, NoticeDialog } from './ExportDialog';\nimport { pickImportFile, readImport } from './importing';")
rep(p,"  const [exportOpen, setExportOpen] = useState(false);","""  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<{ title: string; lead: string; items: string[] } | null>(null);
  const [libVersion, setLibVersion] = useState(0);""")
rep(p,"""  // The color picker's swatches""","""  const importFile = async () => {
    const f = await pickImportFile();
    if (!f) return;
    try {
      const got = await readImport(f.name, new Uint8Array(await f.arrayBuffer()));
      if (got.kind === 'project') {
        open(got.project, null, null);
        store.set({ dirty: true, status: `Imported ${f.name}` });
        if (got.notes.length) setNotice({ title: 'Imported', lead: `${f.name} is open as a title. Some things are drawn differently:`, items: got.notes });
        return;
      }
      const { pack } = got;
      let added = 0;
      for (const t of pack.titles) {
        await host.saveLibrary({ ...t, id: `${t.id}-${Date.now().toString(36)}${added}` }, null);
        added++;
      }
      setLibVersion((v) => v + 1);
      setSide('library');
      store.set({ status: `Added ${added} title${added === 1 ? '' : 's'} from ${pack.info.name} to the library` });
      const about = [pack.info.author && `by ${pack.info.author}`, pack.info.version && `version ${pack.info.version}`, pack.info.license && `license ${pack.info.license}`]
        .filter(Boolean)
        .join(', ');
      setNotice({
        title: pack.info.name || 'Template pack',
        lead: `Added ${added} title${added === 1 ? '' : 's'} to your library${about ? ` (${about})` : ''}.${pack.problems.length ? ' Some could not be read:' : ''}`,
        items: pack.problems,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      store.set({ status: msg });
      setNotice({ title: 'Import', lead: msg, items: [] });
    }
  };

  // The color picker's swatches""")
rep(p,"""            <button onClick={() => setExportOpen(true)}""","""            <button onClick={() => void importFile()} title="Import a Lottie animation (After Effects, LottieFiles), a template pack or a .lumtitle file">
              <FileInput size={15} /> Import
            </button>
            <button onClick={() => setExportOpen(true)}""")
rep(p,"""        {exportOpen && <ExportDialog""","""        {notice && <NoticeDialog {...notice} onClose={() => setNotice(null)} />}
        {exportOpen && <ExportDialog""")
rep(p,"<LibraryPanel store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />","<LibraryPanel key={libVersion} store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />")
