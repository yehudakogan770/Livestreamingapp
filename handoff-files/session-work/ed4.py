import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Panels.tsx'; s=open(p).read()
s=s.replace("import { readSource, valuesFromRow, type Table } from '../core/data';\n","")
open(p,'w').write(s)
p='Designer.tsx'; s=open(p).read()
s=s.replace("import { usePreviewCues } from './previewCues';","import { usePreviewCues } from './previewCues';\nimport { useLiveData } from './liveData';")
s=s.replace("""  // Audio cues sound as the preview passes them.
  usePreviewCues(store, host.urlFor);""","""  // Audio cues sound as the preview passes them.
  usePreviewCues(store, host.urlFor);

  // Data sources are read again on their intervals.
  useLiveData(store);""")
open(p,'w').write(s)
p='designer.css'; s=open(p).read()
s+='''
/* A new field: its label, then its kind and the button. */
.tt-newfield {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--tt-line-2);
  border-radius: var(--tt-radius);
}
.tt-newfield-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--tt-dim);
}
.tt-newfield-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.tt-newfield-row .tt-select {
  flex: 1;
}

/* The timeline's Fit (the whole composition across). */
.tt-tl-tabs .tt-fit {
  height: 22px;
  padding: 0 8px !important;
  color: var(--tt-dim);
}
.tt-tl-tabs .tt-fit.on {
  color: var(--tt-text);
  background: var(--tt-selected);
}
'''
open(p,'w').write(s)
