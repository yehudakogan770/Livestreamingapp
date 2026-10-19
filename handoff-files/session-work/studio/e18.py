root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/Inspector.tsx', [
("""import { graphOf } from '../model/nodes';""","""import { graphOf } from '../model/nodes';
import { newPluginEffect, pluginOf } from '../model/plugins';
import { uid, type Project } from '../model/types';
import { PluginControls, PluginPicker } from './Plugins';"""),
("""  const t = usePlayhead(engine);
  const ids = selectedIds(selection);

  if (selection?.kind === 'marker') {""","""  const t = usePlayhead(engine);
  const ids = selectedIds(selection);
  const [picking, setPicking] = useState<string | null>(null);

  if (selection?.kind === 'marker') {"""),
("""            {['eq', 'voice', 'compressor', 'denoise', 'voiceiso', 'dehum', 'loudnorm'].map((type) => (
              <button key={type} type="button" className="btn btn--sm" onClick={() => actions.addEffect([sound.id], type)}>
                + {effectDef(type)?.name}
              </button>
            ))}
          </div>""","""            {['eq', 'voice', 'compressor', 'denoise', 'voiceiso', 'dehum', 'loudnorm'].map((type) => (
              <button key={type} type="button" className="btn btn--sm" onClick={() => actions.addEffect([sound.id], type)}>
                + {effectDef(type)?.name}
              </button>
            ))}
            {inApp() && (
              <button type="button" className="btn btn--sm" title="An effect plug-in installed on this computer" onClick={() => setPicking(sound.id)}>
                + VST3 plug-in…
              </button>
            )}
          </div>
          {picking === sound.id && (
            <PluginPicker
              onClose={() => setPicking(null)}
              onPick={(f) => {
                setPicking(null);
                upd(sound, `Add ${f.name}`, (c) => ({ ...c, effects: [...c.effects, newPluginEffect(f, uid('e'))] }));
              }}
            />
          )}"""),
("""            <EffectSection
              key={e.id}
              clip={sound}
              effect={e}
              local={Math.max(0, Math.min(sound.length - 1, t - sound.start))}
              onSeek={seek}
              upd={upd}
              ui={ui}
            />""","""            <EffectSection
              key={e.id}
              clip={sound}
              effect={e}
              local={Math.max(0, Math.min(sound.length - 1, t - sound.start))}
              onSeek={seek}
              upd={upd}
              ui={ui}
              project={project}
            />"""),
("""  ui: Ui;
  /** More rows (tracking, AI masks, "Limit to"). */
  extra?: React.ReactNode;
}) {
  const def = effectDef(effect.type);""","""  ui: Ui;
  /** More rows (tracking, AI masks, "Limit to"). */
  extra?: React.ReactNode;
  /** The project (for plug-in effects: where the clip's sound comes from). */
  project?: Project;
}) {
  const def = effectDef(effect.type);"""),
("""  ui,
  extra,
}: {
  clip: Clip;
  effect: Effect;""","""  ui,
  extra,
  project,
}: {
  clip: Clip;
  effect: Effect;"""),
("""          {def.name}
        </span>
      }""","""          {effect.type === 'vst3' ? (pluginOf(effect)?.name ?? def.name) : def.name}
        </span>
      }"""),
("""      {def.previewNote && <p className="insp__note">{def.previewNote}</p>}""","""      {def.previewNote && <p className="insp__note">{def.previewNote}</p>}
      {effect.type === 'vst3' && project && (
        <PluginControls
          project={project}
          clip={clip}
          effect={effect}
          onChange={(d, label) => set({ d: d as unknown as Record<string, unknown> }, true)}
        />
      )}"""),
])
