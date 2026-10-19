import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
("""          onCue={showCue}
          onFirstUntimed={firstUntimed}
        />
        {shared}
      </>
    );
""",
"""          onCue={showCue}
          onFirstUntimed={firstUntimed}
          extra={
            isPro
              ? {
                  onShow: () => onTab('show'),
                  onAir: live.live?.state === 'running' || live.live?.state === 'paused',
                  strip: <NowNextStrip data={showData} />,
                  bodyName: listKind(tab) ? KIND_WORDS[listKind(tab)!].name : tab === 'files' ? 'Files' : '',
                  body: listKind(tab) ? (
                    <ListView
                      kind={listKind(tab)!}
                      store={items}
                      canEdit={canEdit}
                      me={me.id}
                      cues={cues}
                      people={people}
                      planName={plan.name}
                      onCue={(id) => {
                        setSel(id);
                        onTab('run');
                      }}
                    />
                  ) : tab === 'files' ? (
                    <FilePanel store={files} cues={cues} canEdit={canEdit} />
                  ) : null,
                  menu: [
                    { label: canEdit ? 'Run the show' : 'Follow the show', run: () => onTab('show') },
                    { label: 'Stage timer', run: () => onTab('timer') },
                    { label: 'Prompter', run: () => onTab('prompter') },
                    ...LIST_TABS.filter((t) => t.kind !== 'budget' || canEdit).map((t) => ({ label: KIND_WORDS[t.kind].name, run: () => onTab(t.tab) })),
                    { label: 'Files', run: () => onTab('files') },
                    { label: 'Print or save as PDF…', run: () => setDialog('print') },
                    { label: 'Versions…', run: () => setDialog('versions') },
                    { label: 'Plan settings…', run: () => setDialog('settings') },
                    ...(canEdit ? [{ label: 'Import cues from a sheet…', run: () => setDialog('import') }] : []),
                    { label: 'Download for Excel', run: () => exportSheet('xlsx') },
                    { label: 'Add to a calendar', run: () => downloadText(`${plan.name || 'Plan'}.ics`, planToIcs(plan, cues, blocks.blocks), 'text/calendar') },
                  ],
                  inspector: { pro: true, columns: plan.columns, items, files, people },
                  people: mentionable,
                  editable,
                }
              : undefined
          }
        />
        {shared}
      </>
    );
"""),
])
