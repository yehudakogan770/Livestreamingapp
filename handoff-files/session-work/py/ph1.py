import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PhonePlan.tsx'
apply(P, [
("""import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, Ellipsis, Plus, UserPlus } from 'lucide-react';""",
"""import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, Ellipsis, Plus, Radio, UserPlus } from 'lucide-react';
import type { Mentionable } from './mentions';"""),
("""  onCue: (n: number) => void;
  onFirstUntimed: () => void;
}""",
"""  onCue: (n: number) => void;
  onFirstUntimed: () => void;
  /** The show-day tools (with update 10 on the server). */
  extra?: PhoneExtra;
}

export interface PhoneExtra {
  /** Run (or follow) the show. */
  onShow: () => void;
  /** The show is running now. */
  onAir: boolean;
  /** Now/Next while the show runs. */
  strip: ReactNode;
  /** What a list or files tab shows (and its name). */
  body: ReactNode;
  bodyName: string;
  /** More actions for the ⋯ menu. */
  menu: { label: string; run: () => void }[];
  /** Extra details for the cue sheet (script, color, tasks, files…). */
  inspector: Partial<ComponentProps<typeof Inspector>>;
  /** People on the plan (for @mentions in the chat). */
  people: Mentionable[];
}"""),
("""  onCue,
  onFirstUntimed,
}: PhonePlanProps) {""",
"""  onCue,
  onFirstUntimed,
  extra,
}: PhonePlanProps) {"""),
("""          <nav className="phone__acts" aria-label="Plan actions">
            <button type="button" className="btn btn--quiet btn--icon" onClick={onShare} aria-label="Share">""",
"""          <nav className="phone__acts" aria-label="Plan actions">
            {extra && (
              <button
                type="button"
                className={`btn btn--quiet btn--icon${extra.onAir ? ' btn--onair' : ''}`}
                onClick={extra.onShow}
                aria-label={extra.onAir ? 'Live now: on now and next' : canEdit ? 'Run the show' : 'Follow the show'}
              >
                <Radio size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="btn btn--quiet btn--icon" onClick={onShare} aria-label="Share">"""),
("""      {tab === 'run' && nowSec !== null && <NowNext sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} onOpen={onSel} />}""",
"""      {extra?.onAir ? extra.strip : tab === 'run' && nowSec !== null && <NowNext sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} onOpen={onSel} />}
      {extra && extra.bodyName && (
        <div className="phone__list phone__extra">
          <h2 className="page__sub page__sub--first">{extra.bodyName}</h2>
          {extra.body}
        </div>
      )}"""),
("""          <Chat chat={chat} me={me.id} isOwner={role === 'owner'} cueCount={cues.length} onCue={onCue} planName={plan.name} />""",
"""          <Chat chat={chat} me={me.id} isOwner={role === 'owner'} cueCount={cues.length} onCue={onCue} planName={plan.name} people={extra?.people} />"""),
("""      {canEdit && tab !== 'chat' && (""",
"""      {canEdit && (tab === 'run' || tab === 'schedule') && ("""),
("""            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                window.print();
              }}
            >
              Print or save as PDF
            </button>""",
"""            {(extra?.menu ?? []).map((m) => (
              <button
                key={m.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  m.run();
                }}
              >
                {m.label}
              </button>
            ))}
            {!extra && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  window.print();
                }}
              >
                Print or save as PDF
              </button>
            )}"""),
("""              timed={sched.rows[selIndex]}
              onSel={onSel}
              phone
            />""",
"""              timed={sched.rows[selIndex]}
              onSel={onSel}
              phone
              {...extra?.inspector}
              canEdit={extra?.inspector.canEdit ?? canEdit}
            />"""),
])
