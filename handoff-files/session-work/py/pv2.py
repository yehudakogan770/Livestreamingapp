import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
# Header: Go live button and the More menu
("""          <button type="button" className="btn" onClick={() => setSharing(true)}>
            <UserPlus size={15} strokeWidth={1.75} aria-hidden="true" />
            Share…
          </button>
          <button type="button" className="btn btn--icon" onClick={() => window.print()} title="Print, or save as PDF" aria-label="Print / PDF">
            <Printer size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>""",
"""          {isPro && (
            <button
              type="button"
              className={`btn${live.live?.state === 'running' || live.live?.state === 'paused' ? ' btn--onair' : ''}`}
              onClick={() => onTab('show')}
              title={canEdit ? 'Call the show: GO for each cue, with timers for everyone' : 'Follow the show: what is on now and next'}
            >
              <Radio size={15} strokeWidth={1.75} aria-hidden="true" />
              {live.live?.state === 'running' || live.live?.state === 'paused' ? 'Live now' : canEdit ? 'Run the show' : 'Follow the show'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setSharing(true)}>
            <UserPlus size={15} strokeWidth={1.75} aria-hidden="true" />
            Share…
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => (isPro ? setDialog('print') : window.print())}
            title="Print, or save as PDF"
            aria-label="Print / PDF"
          >
            <Printer size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>"""),
("""            {more && (
              <div className="popover" role="menu" aria-label="More" onMouseLeave={() => setMore(false)}>
                <button
                  type="button"
                  role="menuitem"
                  className="popover__item"
                  onClick={() => {
                    setMore(false);
                    window.print();
                  }}
                >
                  Print or save as PDF
                </button>""",
"""            {more && (
              <div className="popover popover--menu" role="menu" aria-label="More" onMouseLeave={() => setMore(false)}>
                <button
                  type="button"
                  role="menuitem"
                  className="popover__item"
                  onClick={() => {
                    setMore(false);
                    if (isPro) setDialog('print');
                    else window.print();
                  }}
                >
                  Print or save as PDF…
                </button>
                {isPro && (
                  <>
                    <MenuItem onClick={() => (setMore(false), setDialog('settings'))}>Plan settings (time zone, columns)…</MenuItem>
                    <MenuItem onClick={() => (setMore(false), setDialog('versions'))}>Versions…</MenuItem>
                    {canEdit && <MenuItem onClick={() => (setMore(false), setDialog('import'))}>Import cues from a sheet…</MenuItem>}
                    <div className="popover__sep" role="separator" />
                    <MenuItem onClick={() => (setMore(false), exportSheet('xlsx'))}>Download for Excel (.xlsx)</MenuItem>
                    <MenuItem onClick={() => (setMore(false), exportSheet('csv'))}>Download as CSV</MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        downloadText(`${plan.name || 'Plan'}.ics`, planToIcs(plan, cues, blocks.blocks), 'text/calendar');
                      }}
                    >
                      Add to a calendar (.ics)
                    </MenuItem>
                    <div className="popover__sep" role="separator" />
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        const name = prompt('Name of the copy:', `${plan.name || 'Untitled plan'} (copy)`);
                        if (name === null) return;
                        pro
                          .copyPlan(db(), plan.id, name, false)
                          .then((id) => (location.hash = `#/plan/${id}`))
                          .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      Duplicate plan…
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        const name = prompt('Name of the template:', `${plan.name || 'Untitled plan'} template`);
                        if (name === null) return;
                        pro
                          .copyPlan(db(), plan.id, name, true)
                          .then(() => alert('Saved. New plans can start from it (New plan → From a template).'))
                          .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      Save as a template…
                    </MenuItem>
                    {layout.device === 'computer' && <MenuItem onClick={() => (setMore(false), setDialog('keys'))}>Keyboard shortcuts</MenuItem>}
                    <div className="popover__sep" role="separator" />
                  </>
                )}"""),
# Meta: time zone next to show starts
("""                onChange={(v) => store.editPlan({ startTime: v })}
                className="input input--time"
              />
            </span>
          </label>""",
"""                onChange={(v) => store.editPlan({ startTime: v })}
                className="input input--time"
              />
              {plan.timeZone && validZone(plan.timeZone) && (
                <button type="button" className="mini__zone" title={`Times are ${plan.timeZone.replace(/_/g, ' ')}`} onClick={() => setDialog('settings')}>
                  {zoneAbbr(plan.timeZone)}
                </button>
              )}
            </span>
          </label>"""),
# Tabs
("""            <button type="button" role="tab" className="tabs__tab" aria-selected={tab !== 'schedule'} onClick={() => onTab('run')}>
              Run of show
              <span className="tabs__n">{cues.length}</span>
            </button>
            <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'schedule'} onClick={() => onTab('schedule')}>
              Schedule
              {blocks.blocks.length > 0 && <span className="tabs__n">{blocks.blocks.length}</span>}
            </button>
          </div>""",
"""            <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'run' || tab === 'chat'} onClick={() => onTab('run')}>
              Run of show
              <span className="tabs__n">{cues.length}</span>
            </button>
            <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'schedule'} onClick={() => onTab('schedule')}>
              Schedule
              {blocks.blocks.length > 0 && <span className="tabs__n">{blocks.blocks.length}</span>}
            </button>
            {isPro &&
              LIST_TABS.filter((t) => t.kind !== 'budget' || canEdit).map((t) => {
                const n = listOf(items.items, t.kind);
                const open = t.kind === 'task' ? n.filter((x) => !x.done).length : n.length;
                return (
                  <button key={t.tab} type="button" role="tab" className="tabs__tab" aria-selected={tab === t.tab} onClick={() => onTab(t.tab)}>
                    {KIND_WORDS[t.kind].name}
                    {open > 0 && <span className="tabs__n">{open}</span>}
                  </button>
                );
              })}
            {isPro && (
              <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'files'} onClick={() => onTab('files')}>
                Files
                {files.files.length > 0 && <span className="tabs__n">{files.files.length}</span>}
              </button>
            )}
          </div>"""),
("""          {tab !== 'schedule' && canEdit && (
            <button
              type="button"
""",
"""          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button"
"""),
("""        {error && <p className="warn plan__error">{error}</p>}
""",
"""        {error && <p className="warn plan__error">{error}</p>}
        {isPro && <NowNextStrip data={showData} />}
"""),
# Body
("""          {tab === 'schedule' ? (
            <ScheduleView""",
"""          {listKind(tab) ? (
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
            <div className="files-page">
              <FilePanel store={files} cues={cues} canEdit={canEdit} />
            </div>
          ) : tab === 'schedule' ? (
            <ScheduleView"""),
("""              canEdit={canEdit}
              onNow={onNow}
              commentCount={commentCount}
              hasStart={!!plan.startTime}""",
"""              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}
              onNow={onNow}
              commentCount={commentCount}
              hasStart={!!plan.startTime}"""),
("""        {tab !== 'schedule' && (
          <footer className="status">""",
"""        {(tab === 'run' || tab === 'chat') && (
          <footer className="status">"""),
("""            {plan.startTime && sched.endSec !== null && (
              <span>
                Ends <b>{clock12(sched.endSec)}</b>
              </span>
            )}""",
"""            {plan.startTime && sched.endSec !== null && (
              <span>
                Ends <b>{clock12(sched.endSec)}</b>
                {plan.timeZone && validZone(plan.timeZone) && ` ${zoneAbbr(plan.timeZone)}`}
              </span>
            )}
            {plan.endBy && sched.endSec !== null && parseClock(plan.endBy) !== null && (
              <EndBy endSec={sched.endSec} endBy={parseClock(plan.endBy)!} />
            )}"""),
])
