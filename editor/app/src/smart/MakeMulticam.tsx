// Sequence > New multicam clip from files: choose the cameras and sound
// recorders that filmed the same thing, line them up by their sound (or their
// starts), check the offsets, and make a multicam group with a sequence that
// plays it. One step for Undo.
import { useMemo, useState } from 'react';
import type { MediaItem } from '../model/types';
import { useDoc, type Doc } from '../doc';
import { Choice, Modal } from '../ui/controls';
import type { Ui } from '../ui/state';
import { check, peaksOf } from './analysis';
import { Progress, useJob } from './job';
import { buildMulticam, defaultSound, findOffset, offsetsFrom, recordedAt, SURE, timecodeSeconds } from './syncsound';

interface Found {
  id: string;
  /** Seconds after the reference starts. */
  offset: number;
  /** null: lined up by hand or by starts (no sound to compare). */
  confidence: number | null;
}

const stamp = (s: number): string => {
  const sign = s < 0 ? '−' : '+';
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  return `${sign}${m}:${(a % 60).toFixed(2).padStart(5, '0')}`;
};

export function MakeMulticamDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const usable = useMemo(() => project.media.filter((m) => !m.missing && (m.hasVideo || m.hasAudio) && m.kind !== 'image' && !m.range), [project.media]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [by, setBy] = useState<'sound' | 'timecode' | 'clock' | 'starts'>('sound');
  const [name, setName] = useState(`Multicam ${project.groups.length + 1}`);
  const [found, setFound] = useState<Found[] | null>(null);
  const [sound, setSound] = useState<string[] | null>(null);
  const job = useJob();
  const files = chosen.map((id) => usable.find((m) => m.id === id)).filter((m): m is MediaItem => !!m);
  const cams = files.filter((m) => m.hasVideo);
  const soundNow = sound ?? defaultSound(files);
  const stale = found && (found.length !== files.length || found.some((f) => !chosen.includes(f.id)));

  const toggle = (id: string) => {
    setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
    setFound(null);
  };

  const byTimecode = offsetsFrom(files, (m) => (m.source?.timecode ? timecodeSeconds(m.source.timecode, m.fps || 30) : null));
  const byClock = offsetsFrom(files, (m) => recordedAt(m.source?.created));

  const lineUp = async () => {
    if (by === 'starts' || by === 'timecode' || by === 'clock') {
      const given = by === 'timecode' ? byTimecode : by === 'clock' ? byClock : null;
      setFound(files.map((m) => ({ id: m.id, offset: given?.get(m.id) ?? 0, confidence: null })));
      return;
    }
    const out = await job.run(async (j) => {
      // The longest file with sound is the one the others are compared with.
      const withSound = files.filter((m) => m.hasAudio);
      if (!withSound.length) throw new Error('None of these files has sound. Line them up by their starts instead.');
      const ref = withSound.reduce((a, b) => (b.duration > a.duration ? b : a));
      j.progress(0, `Listening to ${ref.name}…`);
      const refPeaks = await peaksOf(ref);
      const result: Found[] = [];
      for (const [i, m] of files.entries()) {
        check(j);
        if (m.id === ref.id) {
          result.push({ id: m.id, offset: 0, confidence: Infinity });
          continue;
        }
        if (!m.hasAudio) {
          result.push({ id: m.id, offset: 0, confidence: null });
          continue;
        }
        j.progress((i + 0.5) / files.length, `Comparing ${m.name}…`);
        const peaks = await peaksOf(m);
        check(j);
        const o = findOffset(refPeaks, peaks);
        result.push({ id: m.id, offset: o.seconds, confidence: o.confidence });
        // Let the progress bar draw between files.
        await new Promise((r) => setTimeout(r, 0));
      }
      return result;
    });
    if (out) setFound(out);
  };

  const nudge = (id: string, by: number) => found && setFound(found.map((f) => (f.id === id ? { ...f, offset: f.offset + by, confidence: null } : f)));

  const make = () => {
    if (!found) return;
    try {
      let made = '';
      doc.edit((p) => {
        const out = buildMulticam(p, {
          name: name.trim() || 'Multicam',
          files: files.map((m) => ({ media: m, offset: found.find((f) => f.id === m.id)?.offset ?? 0 })),
          sound: soundNow,
        });
        made = out.sequence;
        return out.project;
      }, 'New multicam clip');
      if (made) ui.note(`Made “${name.trim() || 'Multicam'}”: ${cams.length} cameras. Switch cameras in the camera wall, or try Smart > Auto multicam edit.`);
      onClose();
    } catch (e) {
      ui.note(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="New multicam clip from files" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <label className="form__row">
            <span>Name</span>
            <input className="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <div className="form__row smart__top">
            <span>Files</span>
            <ol className="smart__list">
              {usable.map((m) => {
                const f = found?.find((x) => x.id === m.id);
                const on = chosen.includes(m.id);
                return (
                  <li key={m.id} className={on ? 'is-on' : ''}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} aria-label={`Use ${m.name}`} />
                    <span className="smart__why">
                      <b>{m.name}</b> {m.hasVideo ? (m.hasAudio ? 'camera' : 'camera, no sound') : 'sound'}
                    </span>
                    {on && f && !stale && (
                      <>
                        <small title="When it starts, after the file the others were compared with">{stamp(f.offset)}</small>
                        {f.confidence !== null && f.confidence !== Infinity && (
                          <small className={f.confidence >= SURE ? '' : 'smart__warn'}>{f.confidence >= SURE ? 'Matched' : 'Check this one'}</small>
                        )}
                        <span className="smart__order">
                          <button type="button" aria-label="A frame earlier" title="A frame earlier" onClick={() => nudge(m.id, -1 / (m.fps || 30))}>
                            −
                          </button>
                          <button type="button" aria-label="A frame later" title="A frame later" onClick={() => nudge(m.id, 1 / (m.fps || 30))}>
                            +
                          </button>
                        </span>
                      </>
                    )}
                    {on && files.length > 0 && m.hasAudio && (
                      <label className="check smart__sound" title="Put this file's sound on the timeline">
                        <input
                          type="checkbox"
                          checked={soundNow.includes(m.id)}
                          onChange={() => setSound(soundNow.includes(m.id) ? soundNow.filter((x) => x !== m.id) : [...soundNow, m.id])}
                        />{' '}
                        Sound
                      </label>
                    )}
                  </li>
                );
              })}
              {usable.length === 0 && <li className="smart__empty">Import the camera and sound files first.</li>}
            </ol>
          </div>
          <div className="form__row">
            <span>Line up by</span>
            <Choice
              value={by}
              options={[
                ['sound', 'Sound', 'Compare what the microphones heard (works when every file heard the room)'],
                ['timecode', 'Timecode', 'The timecode each camera wrote in its file (cameras set to the same time of day)'],
                ['clock', 'Recording time', 'When each camera says it started recording (to the second: check by eye after)'],
                ['starts', 'Starts', 'Every file starts at the same moment'],
              ]}
              onChange={(v) => {
                setBy(v);
                setFound(null);
              }}
              label="Line up by"
            />
          </div>
          {files.length > 1 && ((by === 'timecode' && !byTimecode) || (by === 'clock' && !byClock)) && (
            <p className="form__problem">
              {by === 'timecode' ? 'Not every chosen file has a timecode.' : 'Not every chosen file says when it was recorded.'} Line them up by sound instead.
            </p>
          )}
          <p className="insp__note">
            Choose two or more cameras, and any separate sound recorders. Studio compares their sound to find where each one starts; a clap or a count-in at the
            start helps but is not needed. Files with sound ticked go on the timeline; the other cameras&apos; sound still helps Auto multicam edit.
          </p>
          {found && !stale && found.some((f) => f.confidence !== null && f.confidence < SURE) && (
            <p className="form__problem">Some files did not match clearly. Check them in the camera wall and move them a frame at a time if needed.</p>
          )}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={files.length < 2 || (by === 'timecode' && !byTimecode) || (by === 'clock' && !byClock)}
              onClick={() => void lineUp()}
            >
              {found && !stale ? 'Line up again' : 'Line up'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!found || !!stale || cams.length === 0} onClick={make}>
              Make the multicam clip
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
