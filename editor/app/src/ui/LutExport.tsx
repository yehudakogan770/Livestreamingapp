// Save a clip's color as a .cube LUT: for a camera or monitor on set, or for
// another editor or grading program.
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import type { Clip } from '../model/types';
import { fileName, inApp, native } from '../native';
import { parseCube, type Cube } from '../render/color';
import { builtinCube, gradeToCube, LUT_SIZES } from '../render/luts';
import { Choice, Modal } from './controls';

export interface LutIO {
  saveAs: (name: string) => Promise<string | null>;
  write: (path: string, text: string) => Promise<void>;
  readText: (path: string) => Promise<string>;
}

const nativeLutIO: LutIO = {
  saveAs: async (name) => {
    if (!inApp()) return name;
    return (await save({ title: 'Save the look as a LUT', defaultPath: name, filters: [{ name: 'LUT', extensions: ['cube'] }] })) ?? null;
  },
  write: async (path, text) => {
    if (inApp()) return native.writeText(path, text);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(path);
    a.click();
  },
  readText: (path) => native.readText(path),
};

/** The LUT files a clip's LUT effects use, read so they can go into the new LUT. */
async function cubesOf(clip: Clip, io: LutIO): Promise<Map<string, Cube | null>> {
  const out = new Map<string, Cube | null>();
  for (const e of clip.effects) {
    const path = e.type === 'lut' && typeof e.d?.path === 'string' ? e.d.path : '';
    if (!path || out.has(path)) continue;
    out.set(path, builtinCube(path) ?? (await io.readText(path).then(parseCube, () => null)));
  }
  return out;
}

export function LutExportDialog({
  clip,
  at,
  onClose,
  onSaved,
  io = nativeLutIO,
}: {
  clip: Clip;
  at: number;
  onClose: () => void;
  onSaved: (msg: string) => void;
  io?: LutIO;
}) {
  const [size, setSize] = useState<number>(33);
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState<string[] | null>(null);
  const run = async () => {
    setProblem('');
    try {
      const cubes = await cubesOf(clip, io);
      const made = gradeToCube(clip, at, size, (p) => cubes.get(p) ?? null, clip.name);
      setNotes(made.notes);
      const path = await io.saveAs(`${clip.name || 'Look'}.cube`);
      if (!path) return;
      await io.write(path, made.text);
      onSaved(`Saved ${fileName(path)} (${size}×${size}×${size})`);
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal title="Export the look as a LUT" onClose={onClose}>
      <div className="form">
        <p className="dlv__note">
          Saves this clip’s color (its grade nodes and LUTs, as they are at the playhead) as a .cube file that cameras, monitors and other editors can load.
        </p>
        <div className="form__row">
          <span>Size</span>
          <Choice<number>
            value={size}
            options={LUT_SIZES.map(
              (n) => [n, String(n), n === 17 ? 'For cameras and monitors' : n === 33 ? 'For most software' : 'For finishing'] as [number, string, string],
            )}
            onChange={setSize}
            label="LUT size"
          />
        </div>
        <p className="dlv__note">
          17 for cameras and monitors, 33 for most software, 65 for finishing. Windows and vignettes are left out: a LUT only changes colors.
        </p>
        {notes?.map((n) => (
          <p key={n} className="dlv__note">
            {n}
          </p>
        ))}
        {problem && <p className="form__problem">{problem}</p>}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void run()}>
            <FileDown />
            Save LUT…
          </button>
        </div>
      </div>
    </Modal>
  );
}
