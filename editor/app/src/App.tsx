import { useCallback, useEffect, useState } from 'react';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Gate } from '../../../app/src/auth/Gate';
import { UpdateBar } from '../../../app/src/components/UpdateBar';
import { parseEvent } from './model/event';
import { readProject } from './model/build';
import { emptyProject, type Project } from './model/types';
import { baseName, inApp, native } from './native';
import { remember } from './recent';
import { Start } from './ui/Start';
import { Getting } from './ui/Getting';
import { Editor } from './ui/Editor';
import { demoProject } from './demo';

type Screen = { s: 'start'; problem?: string } | { s: 'getting'; eventPath: string; text: string } | { s: 'edit'; project: Project; savePath: string };

/** Where the edit of an event is kept: next to its event file. */
export const editPathFor = (eventPath: string): string => eventPath.replace(/\.lumora$/i, '') + '.lumoraedit';

export function App() {
  // Trying the screens in a browser while building them (never in the program).
  if (import.meta.env.DEV && !inApp() && /[?&](demo|start|empty)/.test(location.search)) return <Main />;
  return (
    <Gate>
      <Main />
      <UpdateBar product="Lumora Edit" />
    </Gate>
  );
}

function Main() {
  const [screen, setScreen] = useState<Screen>({ s: 'start' });

  const openPath = useCallback(async (path: string) => {
    try {
      if (/\.lumoraedit$/i.test(path)) {
        const project = readProject(await native.readText(path));
        remember(path, project.name);
        setScreen({ s: 'edit', project, savePath: path });
        return;
      }
      const text = await native.readText(path);
      const event = parseEvent(text);
      const editPath = editPathFor(path);
      if (await native.fileExists(editPath)) {
        const carryOn = await ask(`You already started editing “${event.name}”. Carry on with that edit?`, {
          title: 'Lumora Edit',
          kind: 'info',
          okLabel: 'Carry on',
          cancelLabel: 'Start again',
        });
        if (carryOn) {
          const project = readProject(await native.readText(editPath));
          remember(editPath, project.name);
          setScreen({ s: 'edit', project, savePath: editPath });
          return;
        }
      }
      setScreen({ s: 'getting', eventPath: path, text });
    } catch (e) {
      setScreen({ s: 'start', problem: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const choose = useCallback(async () => {
    const picked = await open({
      title: 'Open a project or an event',
      multiple: false,
      filters: [{ name: 'Lumora Edit projects and Lumora events', extensions: ['lumoraedit', 'lumora'] }],
    });
    if (typeof picked === 'string') void openPath(picked);
  }, [openPath]);

  /** A new, empty project: where to keep it is asked first (it then saves as you go). */
  const create = useCallback(async () => {
    if (!inApp()) {
      setScreen({ s: 'edit', project: emptyProject('Untitled'), savePath: '' });
      return;
    }
    const picked = await save({
      title: 'Where to keep the new project',
      defaultPath: 'My video.lumoraedit',
      filters: [{ name: 'Lumora Edit project', extensions: ['lumoraedit'] }],
    });
    if (!picked) return;
    const project = emptyProject(baseName(picked));
    await native.writeText(picked, JSON.stringify(project));
    remember(picked, project.name);
    setScreen({ s: 'edit', project, savePath: picked });
  }, []);

  // Opened by double-clicking a file, or a file dropped on the start screen.
  useEffect(() => {
    if (!inApp()) {
      const q = new URLSearchParams(location.search);
      if (q.has('demo')) void demoProject().then((project) => setScreen({ s: 'edit', project, savePath: '' }));
      if (q.has('empty')) setScreen({ s: 'edit', project: emptyProject('Untitled'), savePath: '' });
      return;
    }
    void native.initialFile().then((f) => f && void openPath(f));
    let stop: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== 'drop') return;
        const f = e.payload.paths.find((p) => /\.(lumora|lumoraedit)$/i.test(p));
        if (f) void openPath(f);
      })
      .then((u) => (stop = u));
    return () => stop?.();
  }, [openPath]);

  useEffect(() => {
    if (!inApp()) return;
    const name = screen.s === 'edit' ? `${screen.project.name} — Lumora Edit` : 'Lumora Edit';
    void getCurrentWindow()
      .setTitle(name)
      .catch(() => {});
  }, [screen]);

  if (screen.s === 'getting')
    return (
      <Getting
        eventPath={screen.eventPath}
        text={screen.text}
        onDone={(project) => {
          const savePath = editPathFor(screen.eventPath);
          remember(savePath, project.name);
          setScreen({ s: 'edit', project, savePath });
        }}
        onCancel={(problem) => setScreen({ s: 'start', ...(problem ? { problem } : {}) })}
      />
    );
  if (screen.s === 'edit')
    return (
      <Editor
        key={screen.savePath || 'unsaved'}
        project={screen.project}
        savePath={screen.savePath}
        onClose={() => setScreen({ s: 'start' })}
        onOpen={() => void choose()}
        onNew={() => void create()}
      />
    );
  return <Start problem={screen.problem} onChoose={() => void choose()} onNew={() => void create()} onOpen={(p) => void openPath(p)} />;
}
