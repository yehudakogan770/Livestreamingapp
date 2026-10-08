import { CircleStop, Play, SlidersHorizontal, Wand2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  STYLES,
  atemInputName,
  atemInputs,
  atemSend,
  atemSet,
  atemStatus,
  connectionLine,
  defaultAtemSettings,
  setMapping,
  suggestMapping,
  tallyOf,
  watchAtem,
  type AtemCommand,
  type AtemSettings,
  type AtemStatus,
} from '../engine/atem';
import type { Source } from '../engine/types/Source';
import './AtemDialog.css';

/** Settings → ATEM switcher: connect, switch it, map Lumora's inputs to it. */
export function AtemDialog({ sources, onClose }: { sources: Source[]; onClose: () => void }) {
  const [st, setSt] = useState<AtemStatus | null>(null);
  const [host, setHost] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    atemStatus().then(
      (s) => {
        if (!live) return;
        setSt(s);
        setHost(s.settings.host);
      },
      (e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)),
    );
    const stop = watchAtem((s) => live && setSt(s));
    return () => {
      live = false;
      stop();
    };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const settings = st?.settings ?? defaultAtemSettings();
  const save = (p: Partial<AtemSettings>) =>
    void atemSet({ ...settings, ...p }).then(setSt, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  const send = (...c: AtemCommand[]) => {
    setProblem(null);
    atemSend(...c).catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };
  const state = st?.connection === 'connected' ? st.state : null;
  const me = state?.mixEffects[0] ?? null;
  const inputs = atemInputs(state);
  const videoInputs = sources.filter((s) => !['microphone'].includes(s.kind.type));
  const mapped = (id: string) => settings.mapping.find((r) => r.sourceId === id)?.atemInput ?? null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="ATEM switcher" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box atem">
        <header className="modal__head">
          <h2>
            <SlidersHorizontal className="modal__icon" aria-hidden="true" />
            ATEM switcher
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="atem__body">
          <p className="field__note">
            Control a Blackmagic ATEM switcher on this network from Lumora, or let Lumora follow it. The switcher and this computer need to be on the same
            network; its address is on the switcher (Settings → Network) or in ATEM Setup.
          </p>

          <section className="atem__section" aria-label="Connection">
            <form
              className="atem__connect"
              onSubmit={(e) => {
                e.preventDefault();
                setProblem(null);
                save({ host: host.trim(), connect: true });
              }}
            >
              <label className="field">
                <span className="field__label">Switcher address</span>
                <input
                  className="text atem__host"
                  value={host}
                  placeholder="192.168.10.240"
                  onChange={(e) => setHost(e.target.value)}
                  aria-label="Switcher address"
                  spellCheck={false}
                />
              </label>
              {settings.connect ? (
                <button type="button" className="btn" onClick={() => save({ connect: false })}>
                  Disconnect
                </button>
              ) : (
                <button type="submit" className="btn btn--primary" disabled={!host.trim()}>
                  Connect
                </button>
              )}
              {settings.connect && host.trim() !== settings.host && (
                <button type="submit" className="btn">
                  Use this address
                </button>
              )}
            </form>
            <span className={`atem__state${st?.connection === 'connected' ? ' is-on' : ''}`} role="status">
              {st ? connectionLine(st) : 'Loading…'}
            </span>
          </section>
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}

          {state && me && (
            <section className="atem__section atem__section--col" aria-label="Switcher">
              <div className="atem__bus">
                <span className="atem__buslabel">Program</span>
                {inputs.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className={`atem__src${me.program === i.id ? ' is-program' : ''}`}
                    aria-pressed={me.program === i.id}
                    title={i.longName}
                    onClick={() => send({ type: 'program', me: 0, input: i.id })}
                  >
                    {i.shortName || i.longName}
                  </button>
                ))}
              </div>
              <div className="atem__bus">
                <span className="atem__buslabel">Preview</span>
                {inputs.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className={`atem__src${me.preview === i.id ? ' is-preview' : ''}`}
                    aria-pressed={me.preview === i.id}
                    title={i.longName}
                    onClick={() => send({ type: 'preview', me: 0, input: i.id })}
                  >
                    {i.shortName || i.longName}
                  </button>
                ))}
              </div>
              <div className="atem__row">
                <button type="button" className="btn" onClick={() => send({ type: 'cut', me: 0 })}>
                  Cut
                </button>
                <button type="button" className={`btn${me.inTransition ? ' is-on' : ''}`} onClick={() => send({ type: 'auto', me: 0 })}>
                  Auto
                </button>
                <div className="atem__seg" role="group" aria-label="Transition">
                  {STYLES.map((s) => (
                    <button
                      key={s.style}
                      type="button"
                      className="seg"
                      aria-pressed={me.style === s.style}
                      onClick={() => send({ type: 'transitionStyle', me: 0, style: s.byte })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <label className="atem__rate">
                  Mix rate
                  <input
                    className="text"
                    type="number"
                    min={1}
                    max={250}
                    defaultValue={me.mixRate}
                    key={me.mixRate}
                    aria-label="Mix rate in frames"
                    onBlur={(e) => {
                      const frames = Math.round(Number(e.target.value));
                      if (frames >= 1 && frames <= 250 && frames !== me.mixRate) send({ type: 'mixRate', me: 0, frames });
                    }}
                  />
                  frames
                </label>
                <button
                  type="button"
                  className={`btn${me.ftbBlack ? ' is-danger' : ''}`}
                  aria-pressed={me.ftbBlack}
                  onClick={() => send({ type: 'fadeToBlack', me: 0 })}
                >
                  Fade to black
                </button>
              </div>
              {(state.dsks.length > 0 || me.uskOnAir.length > 0) && (
                <div className="atem__row" aria-label="Keyers">
                  {me.uskOnAir.map((on, k) => (
                    <button key={`u${k}`} type="button" className="seg" aria-pressed={on} onClick={() => send({ type: 'uskOnAir', me: 0, keyer: k, on: !on })}>
                      Key {k + 1}
                    </button>
                  ))}
                  {state.dsks.map((d, k) => (
                    <span key={`d${k}`} className="atem__dsk">
                      <button type="button" className="seg" aria-pressed={d.onAir} onClick={() => send({ type: 'dskOnAir', keyer: k, on: !d.onAir })}>
                        DSK {k + 1}
                      </button>
                      <button type="button" className="linkbtn" onClick={() => send({ type: 'dskAuto', keyer: k })}>
                        Auto
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {state.macros.length > 0 && (
                <div className="atem__row" aria-label="Macros">
                  <span className="atem__buslabel">Macros</span>
                  {state.macros.map((m) => (
                    <button
                      key={m.index}
                      type="button"
                      className="btn btn--small"
                      aria-pressed={state.macroRunning === m.index}
                      onClick={() => send({ type: 'runMacro', index: m.index })}
                    >
                      <Play aria-hidden="true" /> {m.name || `Macro ${m.index + 1}`}
                    </button>
                  ))}
                  {state.macroRunning !== null && (
                    <button type="button" className="btn btn--small" onClick={() => send({ type: 'stopMacro' })}>
                      <CircleStop aria-hidden="true" /> Stop
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="atem__section atem__section--col" aria-label="Working together">
            <label className="check atem__switch">
              <input type="checkbox" checked={settings.drive} onChange={(e) => save({ drive: e.target.checked })} /> Lumora drives the ATEM
            </label>
            <span className="field__note">
              TAKE, CUT and Next on Lumora’s Live Screen switch the ATEM’s program and preview, for the inputs in the table below.
            </span>
            {settings.drive && (
              <div className="atem__row">
                <div className="atem__seg" role="group" aria-label="How TAKE switches the ATEM">
                  <button type="button" className="seg" aria-pressed={settings.driveHow === 'transition'} onClick={() => save({ driveHow: 'transition' })}>
                    The ATEM’s transition, at Lumora’s length
                  </button>
                  <button type="button" className="seg" aria-pressed={settings.driveHow === 'cut'} onClick={() => save({ driveHow: 'cut' })}>
                    Always a cut
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={settings.driveBlank} onChange={(e) => save({ driveBlank: e.target.checked })} /> Lumora’s fade to black
                  fades the ATEM too
                </label>
              </div>
            )}
            <label className="check atem__switch">
              <input type="checkbox" checked={settings.follow} onChange={(e) => save({ follow: e.target.checked })} /> Follow the ATEM’s tally
            </label>
            <span className="field__note">
              What the ATEM has on program and preview lights Lumora’s inputs of the same cameras (tally lights, Companion, the control API).
            </span>
            {settings.follow && (
              <label className="field atem__carrier">
                <span className="field__label">The ATEM’s program comes into Lumora on</span>
                <select
                  value={settings.programInput ?? ''}
                  onChange={(e) => save({ programInput: e.target.value || null })}
                  aria-label="The input carrying the ATEM’s program"
                >
                  <option value="">Not taken into Lumora</option>
                  {videoInputs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="field__note">
                  Usually a Blackmagic capture card input fed from the ATEM’s program output. The ATEM’s cameras count as on air only while it is on air in
                  Lumora.
                </span>
              </label>
            )}
          </section>

          <section className="atem__section atem__section--col" aria-label="Inputs">
            <div className="atem__row">
              <span className="atem__buslabel">Lumora input and ATEM input</span>
              <span className="atem__spacer" />
              <button
                type="button"
                className="btn btn--small"
                disabled={!state}
                onClick={() => save({ mapping: suggestMapping(sources, state, settings.mapping) })}
                title="Pair inputs whose names match (Camera 1 with Camera 1)"
              >
                <Wand2 aria-hidden="true" /> Match by name
              </button>
            </div>
            <table className="atem__map">
              <tbody>
                {videoInputs.map((s) => {
                  const a = mapped(s.id);
                  const tally = a === null ? null : tallyOf(state, a);
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <select
                          value={a ?? ''}
                          aria-label={`ATEM input for ${s.name}`}
                          onChange={(e) => save({ mapping: setMapping(settings.mapping, s.id, e.target.value === '' ? null : Number(e.target.value)) })}
                        >
                          <option value="">Not on the ATEM</option>
                          {(inputs.length ? inputs : Array.from({ length: 8 }, (_, i) => ({ id: i + 1, longName: `Input ${i + 1}` }))).map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.longName || atemInputName(state, i.id)}
                            </option>
                          ))}
                          {a !== null && !inputs.some((i) => i.id === a) && inputs.length > 0 && <option value={a}>{atemInputName(state, a)}</option>}
                        </select>
                      </td>
                      <td className={`atem__tally${tally ? ` is-${tally}` : ''}`}>{tally === 'program' ? 'On air' : tally === 'preview' ? 'Preview' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <p className="field__note">
            Buttons for Stream Deck and Companion: the control API’s <code>atem</code> command, for example <code>/api/do/atem?do=cut</code>,{' '}
            <code>do=program&amp;input=2</code>, <code>do=ftb</code>, <code>do=dsk&amp;keyer=1</code>, <code>do=macro&amp;number=3</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
