import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Panels.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''            <Row label="Name">
              <code className="tt-code">{`{{${v.key}}}`}</code>
              <Select''','''            <Row label="Written as" hint="Put this in a text, a color or a picture to use the field there">
              <code className="tt-code">{`{{${v.key}}}`}</code>
            </Row>
            <Row label="Kind">
              <Select''')
rep('''function NewField({ onAdd }: { onAdd: (label: string, type: VariableType) => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<VariableType>('text');
  return (
    <Row label="New field">
      <input className="tt-input" placeholder="Label, e.g. Guest name" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="New field label" />
      <Select label="New field kind" value={type} options={VAR_TYPES} onChange={setType} />
      <button
        className="tt-btn"
        disabled={!label.trim()}
        onClick={() => {
          onAdd(label.trim(), type);
          setLabel('');
        }}
      >
        Add
      </button>
    </Row>
  );
}''','''function NewField({ onAdd }: { onAdd: (label: string, type: VariableType) => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<VariableType>('text');
  const add = () => {
    if (!label.trim()) return;
    onAdd(label.trim(), type);
    setLabel('');
  };
  return (
    <div className="tt-newfield">
      <div className="tt-newfield-head">New field</div>
      <input
        className="tt-input"
        placeholder="Label, e.g. Guest name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        aria-label="New field label"
      />
      <div className="tt-newfield-row">
        <Select label="New field kind" value={type} options={VAR_TYPES} onChange={setType} />
        <button className="tt-btn" disabled={!label.trim()} onClick={add}>
          <Plus size={13} /> Add field
        </button>
      </div>
    </div>
  );
}''')
# Data panel: rows laid out with labels; refresh handled by the live reader.
rep('''              <Row label="Row">
                <NumberField
                  value={src.row + 1}
                  min={1}
                  label="Row"
                  onChange={(r) => upd('Source row', (d) => d.map((x, j) => (j === i ? { ...x, row: Math.max(0, Math.round(r) - 1) } : x)))}
                />
                <NumberField
                  value={src.refresh}
                  min={0}
                  label="Read every (seconds, 0: once)"
                  unit="s"
                  onChange={(refresh) => upd('Source refresh', (d) => d.map((x, j) => (j === i ? { ...x, refresh } : x)))}
                />
                <button className="tt-btn" onClick={() => void read(src)} disabled={!src.url}>
                  Read now
                </button>
              </Row>''','''              <Row label="Row" hint="The row whose columns fill the fields (1: the first row under the headings)">
                <NumberField
                  value={src.row + 1}
                  min={1}
                  label="Row"
                  onChange={(r) => upd('Source row', (d) => d.map((x, j) => (j === i ? { ...x, row: Math.max(0, Math.round(r) - 1) } : x)))}
                />
              </Row>
              <Row label="Read every" hint="Seconds between reads (0: only when Read now is clicked)">
                <NumberField
                  value={src.refresh}
                  min={0}
                  label="Read every (seconds, 0: once)"
                  unit="s"
                  onChange={(refresh) => upd('Source refresh', (d) => d.map((x, j) => (j === i ? { ...x, refresh: Math.max(0, refresh) } : x)))}
                />
                <button className="tt-btn" onClick={() => void read(src)} disabled={!src.url}>
                  Read now
                </button>
              </Row>''')
rep('''  // Read again every few seconds while open.
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    const id = setInterval(() => {
      for (const s of listRef.current) if (s.refresh > 0 && s.url) void read(s);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);''','''  // Read again on each source's own interval while it is open.
  const listRef = useRef(list);
  listRef.current = list;
  const lastRead = useRef(new Map<string, number>());
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      for (const s of listRef.current) {
        if (!(s.refresh > 0) || !s.url) continue;
        if (now - (lastRead.current.get(s.id) ?? 0) < s.refresh * 1000) continue;
        lastRead.current.set(s.id, now);
        void read(s);
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);''')
open(p,'w').write(s)
