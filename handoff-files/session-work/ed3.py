import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Panels.tsx'; s=open(p).read()
a=s.index("  const keys = project.variables.map((v) => v.key);\n  const read = async (src: DataSource) => {")
b=s.index("  return (\n    <div className=\"tt-inspector\">\n      <Section title=\"Data sources\">")
s=s[:a]+"""  const live = liveData(store);
  const tables = useLiveResults(store);
  const read = (src: DataSource) => live.read(src);
"""+s[b:]
s=s.replace("""  const [tables, setTables] = useState<Record<string, Table | string>>({});
""","")
s=s.replace("const t = tables[src.id];","const t = tables.get(src.id);")
s=s.replace("import { askConfirm } from './Modal';","import { askConfirm } from './Modal';\nimport { liveData, useLiveResults } from './liveData';")
open(p,'w').write(s)
