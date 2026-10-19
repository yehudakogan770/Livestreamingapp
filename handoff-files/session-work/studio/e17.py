root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/native.ts', [
("""import type { Job } from './export/audioplan';""","""import type { Job } from './export/audioplan';
import type { ChainLink, FoundPlugin, PluginParam } from './model/plugins';"""),
("""  /** The voice isolation model's path on disk (for FFmpeg's arnndn). */""","""  /** The VST3 effects on this computer (each plug-in file looked at once, in a helper process). */
  vstScan: (again = false) => invoke<{ effects: FoundPlugin[]; broken: { path: string; problem: string }[]; folders: string[] }>('vst_scan', { again }),
  /** A VST3 effect's parameters, its saved settings restored and values set; and its settings after. */
  vstSettings: (path: string, cid: string, state: string | null, set: [number, number][] = []) =>
    invoke<{ params: PluginParam[]; state: string }>('vst_settings', { path, cid, state, set }),
  /** A stretch of a file's sound through VST3 effects, as a WAV file (made once). */
  vstRender: (path: string, from: number, seconds: number, chain: ChainLink[]) => invoke<string>('vst_render', { path, from, seconds, chain }),
  /** The voice isolation model's path on disk (for FFmpeg's arnndn). */"""),
])

edit('editor/app/src/model/effects.ts', [
("""  // The Composite page's node graph""","""  // A VST3 plug-in on a sound clip (which one and its settings in `d`, see model/plugins.ts).
  { type: 'vst3', name: 'VST3 plug-in', kind: 'audio', group: 'Plug-ins', params: [], hidden: true },
  // The Composite page's node graph"""),
])

edit('editor/app/src/player/engine.ts', [
("""import { cleanedSound } from './cleanvoice';""","""import { cleanedSound } from './cleanvoice';
import { onPluginSound, pluginSound } from './plugins';
import { isPlugin } from '../model/plugins';"""),
("""    onSignalCopy(() => (this.dirty = true));""","""    onSignalCopy(() => (this.dirty = true));
    onPluginSound(() => (this.dirty = true));"""),
("""      const iso = heardNow.effects.find((e) => e.type === 'voiceiso');
      const clean = iso ? cleanedSound(heardNow.media, voiceIsoAmount(iso.p)) : null;
      const h = clean ? { ...heardNow, effects: heardNow.effects.filter((e) => e !== iso) } : heardNow;
      let slot = this.sounds.get(h.key);
      const src = clean ? mediaUrl(clean) : fileOf(h.media);""","""      // VST3 effects: the clip's sound through its plug-ins once made (until then, without them).
      const plugged = heardNow.effects.some((e) => isPlugin(e)) ? pluginSound(heardNow.clip, heardNow.media, rate(s)) : null;
      const iso = plugged ? undefined : heardNow.effects.find((e) => e.type === 'voiceiso');
      const clean = iso ? cleanedSound(heardNow.media, voiceIsoAmount(iso.p)) : null;
      const h = plugged
        ? { ...heardNow, time: heardNow.time - plugged.from, effects: heardNow.effects.filter((e) => !isPlugin(e)) }
        : clean
          ? { ...heardNow, effects: heardNow.effects.filter((e) => e !== iso) }
          : heardNow;
      let slot = this.sounds.get(h.key);
      const src = plugged ? mediaUrl(plugged.path) : clean ? mediaUrl(clean) : fileOf(h.media);"""),
])

edit('editor/app/src/export/exporter.ts', [
("""import { mediaTransfer } from '../player/hdrcopy';""","""import { mediaTransfer } from '../player/hdrcopy';
import { withPluginsRendered } from './plugins';
import { renderPlugins } from '../player/plugins';"""),
("""      const jobs = finishJobs(this.p, s, this.o.range, video, this.o.sound ?? 'aac', this.o.loudness, finish);""","""      // VST3 effects: each clip's sound made through its plug-ins first.
      const withPlugins = await withPluginsRendered(this.p, (path, from, seconds, chain) => renderPlugins(path, from, seconds, chain), (done, total) =>
        this.report({ stage: 'sound', done: base0, message: `Running the plug-ins (${done + 1} of ${total})…`, left: null, path: null }),
      );
      const jobs = finishJobs(withPlugins, current(withPlugins), this.o.range, video, this.o.sound ?? 'aac', this.o.loudness, finish);"""),
("""      // Voice isolation uses the neural model""","""      const base0 = video ? 0.86 : 0;
      // Voice isolation uses the neural model"""),
])
