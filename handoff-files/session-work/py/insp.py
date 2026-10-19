import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/Inspector.tsx'
apply(P, [
("""import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2, X } from 'lucide-react';
import { ClockInput, DurationInput, MinSecInput, TimeInput } from './fields';
import { SEGMENTS, TRANSITION_NAMES, clock12, formatDuration, type PlanComment, type PlanCue, type Schedule, type Segment } from './model';
import type { PlanStore } from './usePlan';""",
"""import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Lock, Trash2, X } from 'lucide-react';
import { ClockInput, DurationInput, MinSecInput, TimeInput } from './fields';
import {
  COLOR_NAMES,
  CUE_COLORS,
  MAX_SCRIPT,
  SEGMENTS,
  TRANSITION_NAMES,
  clock12,
  formatDuration,
  scriptLength,
  type CustomColumn,
  type PlanComment,
  type PlanCue,
  type Schedule,
  type Segment,
} from './model';
import type { PlanStore } from './usePlan';
import type { Person } from './api';
import type { ItemStore } from './useItems';
import { CueTasks } from './ListView';
import { FilePanel, type FileStore } from './Files';
import { MentionBox, WithMentions } from './MentionBox';
import { mentionsIn } from './mentions';"""),
("""  onSel,
  phone = false,
}: {""",
"""  onSel,
  phone = false,
  columns = [],
  pro = false,
  locked = false,
  items,
  files,
  people = [],
}: {
  /** The plan's extra columns. */
  columns?: CustomColumn[];
  /** The server has the show-day tools (script, color, float, tasks, files). */
  pro?: boolean;
  /** Its section is locked to other editors. */
  locked?: boolean;
  items?: ItemStore;
  files?: FileStore;
  /** Everyone on the plan (for @mentions). */
  people?: Person[];"""),
("""    store
      .comment(cue.id, text)""",
"""    store
      .comment(cue.id, text, pro ? mentionsIn(text, people, me) : [])"""),
("""      <label className="field">
        <span>Cue</span>
        <input""",
"""      {locked && (
        <p className="muted small row">
          <Lock size={13} strokeWidth={1.75} aria-hidden="true" /> The owner has locked the “{cue.section}” section: you can read it and comment.
        </p>
      )}
      <label className="field">
        <span>Cue</span>
        <input"""),
("""      <label className="field insp-group">
        <span>Notes</span>
        <textarea className="input" rows={4} maxLength={4000} value={cue.notes} readOnly={!canEdit} onChange={(e) => set({ notes: e.target.value })} />
      </label>""",
"""      <label className="field insp-group">
        <span>Notes</span>
        <textarea className="input" rows={4} maxLength={4000} value={cue.notes} readOnly={!canEdit} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {pro && (
        <label className="field">
          <span className="row">
            Script <span className="muted small">(for the prompter)</span>
            <span className="bar__spacer" />
            {cue.script.trim() && (
              <span className="muted small" title="At about 150 words a minute">
                {scriptLength(cue.script).words} words · about {formatDuration(scriptLength(cue.script).secs)} to read
              </span>
            )}
          </span>
          <textarea
            className="input script-box"
            rows={6}
            maxLength={MAX_SCRIPT}
            value={cue.script}
            readOnly={!canEdit}
            placeholder={canEdit ? 'What is said: it scrolls on the Prompter, and Lumora can load it into its prompter.' : ''}
            onChange={(e) => set({ script: e.target.value })}
          />
        </label>
      )}
      {pro && columns.length > 0 && (
        <div className="grid2">
          {columns.map((col) => (
            <label key={col.id} className="field">
              <span>{col.name || 'Untitled column'}</span>
              <input
                className="input"
                value={cue.custom[col.id] ?? ''}
                maxLength={200}
                readOnly={!canEdit}
                onChange={(e) => set({ custom: { ...cue.custom, [col.id]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      )}
      {pro && (
        <div className="grid2">
          <div className="field">
            <span>Color</span>
            <div className="swatches" role="group" aria-label="Cue color">
              <button
                type="button"
                className="swatch swatch--none"
                aria-pressed={!cue.color}
                aria-label="No color"
                title="No color"
                disabled={!canEdit}
                onClick={() => set({ color: '' })}
              />
              {CUE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ ['--sw' as string]: `var(--tag-${c})` }}
                  aria-pressed={cue.color === c}
                  aria-label={COLOR_NAMES[c]}
                  title={COLOR_NAMES[c]}
                  disabled={!canEdit}
                  onClick={() => set({ color: c })}
                />
              ))}
            </div>
          </div>
          <label className="field">
            <span>Timing</span>
            <span className="row small">
              <input type="checkbox" checked={cue.skip} disabled={!canEdit} onChange={(e) => set({ skip: e.target.checked })} />
              Float this cue (keep it, but leave it out of the times)
            </span>
          </label>
        </div>
      )}
      {pro && items && <CueTasks cueId={cue.id} store={items} canEdit={canEdit} me={me} />}
      {pro && files && <FilePanel store={files} cueId={cue.id} cues={[]} canEdit={canEdit} compact />}"""),
("""            <p>{c.text}</p>""",
"""            <p>
              <WithMentions text={c.text} people={people} />
            </p>"""),
("""        <textarea
          className="input"
          rows={2}
          maxLength={2000}
          value={text}
          placeholder={phone ? 'Write a comment' : 'Write a comment (Ctrl+Enter sends)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          aria-label="New comment"
        />""",
"""        <MentionBox
          value={text}
          onChange={setText}
          people={pro ? people.map((p) => ({ userId: p.userId, name: p.name, email: p.email })) : []}
          me={me}
          maxLength={2000}
          placeholder={phone ? 'Write a comment (@ to name someone)' : 'Write a comment (@ names someone; Ctrl+Enter sends)'}
          label="New comment"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
        />"""),
])
