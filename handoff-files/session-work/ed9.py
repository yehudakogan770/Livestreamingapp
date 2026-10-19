import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='workspace.test.tsx'; s=open(p).read()
s=s.replace('''    expect(workspace('operator').rightTab).toBe('fields');
    expect(workspace('data').rightTab).toBe('data');''','''    expect(workspace('operator').docks.right[0]!.active).toBe('fields');
    expect(workspace('data').docks.right[0]!.active).toBe('data');''')
s=s.replace("import { clampSize, loadLayout, recentTitles, rememberTitle, saveLayout, workspace, WORKSPACES } from './workspace';",
"import { clampSize, findPanel, loadLayout, movePanel, normalizeDocks, PANELS, recentTitles, rememberTitle, resizeGroups, saveLayout, showPanel, workspace, WORKSPACES, type Docks } from './workspace';")
s=s.replace('''  it('recent titles: newest first''','''  it('every workspace docks every panel exactly once', () => {
    for (const w of Object.keys(WORKSPACES) as (keyof typeof WORKSPACES)[]) {
      const d = workspace(w).docks;
      const all = [...d.left, ...d.right].flatMap((g) => g.tabs).sort();
      expect(all).toEqual([...PANELS].sort());
    }
  });

  it('an older layout (one tab a side) still opens, with those tabs showing', () => {
    localStorage.setItem('lumora-titler-layout', JSON.stringify({ workspace: 'design', left: 250, right: 330, timeline: 280, leftTab: 'history', rightTab: 'fields' }));
    const l = loadLayout();
    expect(l.docks.left[0]!.active).toBe('history');
    expect(l.docks.right[0]!.active).toBe('fields');
    expect(l.left).toBe(250);
  });

  it('a broken layout is put right: panels once each, none lost', () => {
    const d = normalizeDocks(
      { left: [{ tabs: ['library', 'library', 'bogus' as never], active: 'nope' as never, size: -1 }, { tabs: [], active: 'data', size: 1 }], right: [{ tabs: ['layer'], active: 'layer', size: 1 }] },
      workspace('design').docks,
    );
    const all = [...d.left, ...d.right].flatMap((g) => g.tabs);
    expect(all.sort()).toEqual([...PANELS].sort());
    expect(d.left).toHaveLength(1);
    expect(d.left[0]!.active).toBe('library');
    expect(d.left[0]!.size).toBe(1);
  });
});

describe('docking panels', () => {
  const base = (): Docks => workspace('design').docks;
  const tabsOf = (d: Docks) => ({ left: d.left.map((g) => g.tabs.join(',')), right: d.right.map((g) => g.tabs.join(',')) });

  it('a tab dropped on another group joins it there and shows', () => {
    const d = movePanel(base(), 'fields', { kind: 'tabs', side: 'left', group: 0, index: 1 });
    expect(tabsOf(d)).toEqual({ left: ['library,fields,project,history'], right: ['layer,comp,look,data'] });
    expect(d.left[0]!.active).toBe('fields');
    expect(findPanel(d, 'fields')).toEqual({ side: 'left', group: 0 });
  });

  it('reorders tabs in the same group, and a drop where it is changes nothing', () => {
    expect(tabsOf(movePanel(base(), 'history', { kind: 'tabs', side: 'left', group: 0, index: 0 })).left).toEqual(['history,library,project']);
    expect(tabsOf(movePanel(base(), 'library', { kind: 'tabs', side: 'left', group: 0, index: 3 })).left).toEqual(['project,history,library']);
    expect(tabsOf(movePanel(base(), 'project', { kind: 'tabs', side: 'left', group: 0, index: 1 }))).toEqual(tabsOf(base()));
  });

  it('a drop on the top or bottom of a group makes a new group; an emptied group goes', () => {
    let d = movePanel(base(), 'look', { kind: 'split', side: 'right', group: 0, where: 'after' });
    expect(tabsOf(d).right).toEqual(['layer,comp,fields,data', 'look']);
    d = movePanel(d, 'data', { kind: 'split', side: 'right', group: 0, where: 'before' });
    expect(tabsOf(d).right).toEqual(['data', 'layer,comp,fields', 'look']);
    // At most three groups a side.
    expect(movePanel(d, 'comp', { kind: 'split', side: 'right', group: 1, where: 'after' })).toBe(d);
    // The single-panel group moved away goes.
    d = movePanel(d, 'look', { kind: 'tabs', side: 'left', group: 0, index: 3 });
    expect(tabsOf(d)).toEqual({ left: ['library,project,history,look'], right: ['data', 'layer,comp,fields'] });
  });

  it('a side can be emptied and given a panel again; the height is shared between groups', () => {
    let d = base();
    for (const id of ['library', 'project', 'history'] as const) d = movePanel(d, id, { kind: 'tabs', side: 'right', group: 0, index: 0 });
    expect(d.left).toHaveLength(0);
    d = movePanel(d, 'history', { kind: 'side', side: 'left' });
    expect(tabsOf(d).left).toEqual(['history']);
    d = movePanel(d, 'look', { kind: 'split', side: 'left', group: 0, where: 'after' });
    d = resizeGroups(d, 'left', 0, 0.7);
    expect(d.left[0]!.size / (d.left[0]!.size + d.left[1]!.size)).toBeCloseTo(0.7);
    expect(resizeGroups(d, 'left', 0, 0.99).left[0]!.size / 2).toBeCloseTo(0.85);
    expect(showPanel(d, 'comp').right[0]!.active).toBe('comp');
  });

  it('the layout with its docks is kept', () => {
    const d = movePanel(base(), 'data', { kind: 'side', side: 'left' });
    saveLayout({ ...workspace('design'), docks: d });
    expect(tabsOf(loadLayout().docks)).toEqual(tabsOf(d));
  });

  it('recent titles: newest first''')
s=s.replace('''  it('recent titles: newest first''','''  it('recent titles: newest first''',1)
open(p,'w').write(s)
