// Settings → Run a test event…: the window that sets the test up, shows it
// running (progress, what is happening, Stop), and shows the report.

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { ClipboardCheck, Copy, FileText, FolderOpen, Send, Square, X } from 'lucide-react';
import { BrandMark } from '../components/Logo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSound } from '../audio/SoundContext';
import { useBroadcast } from '../broadcast/BroadcastContext';
import { wantsVertical } from '../broadcast/recorder';
import { isInsideLumora, type EngineClient } from '../engine/client';
import { jewishToolsOn } from '../engine/jewishTools';
import type { Show } from '../engine/types/Show';
import { useProblemStore } from '../problems/problems';
import { sendProblemReport } from '../reports/reporter';
import { LENGTHS, defaultOptions, planInputs, type TestEnv, type TestLength, type TestOptions } from './plan';
import { buildJson, buildMarkdown, outputOk, reportName, type ReportData, type SystemInfo } from './report';
import { cannotStart, findDevices, runTestEvent, type BroadcastApi, type Progress } from './runner';
import { unifiedBlocksTestEvent } from '../engine/unified';
import { OUTPUT_NAMES, VERDICT_WORDS, judge, type Finding } from './verdict';
import './testevent.css';

type Stage = { kind: 'setup' } | { kind: 'running'; progress: Progress | null } | { kind: 'report'; data: ReportData; markdown: string; json: string };

const SEVERITY_LABEL = { critical: 'Critical', problem: 'Problem', note: 'Note' } as const;

export function TestEventDialog({ show, client, onClose }: { show: Show; client: EngineClient; onClose: () => void }) {
  const broadcast = useBroadcast();
  const sound = useSound();
  const problems = useProblemStore();
  // The runner always reads the latest of these.
  const latest = useRef({ show, broadcast, sound });
  latest.current = { show, broadcast, sound };

  const [stage, setStage] = useState<Stage>({ kind: 'setup' });
  const [devices, setDevices] = useState<Pick<TestEnv, 'cameras' | 'mics'> | null>(null);
  const [opts, setOpts] = useState<TestOptions>(() => defaultOptions());
  const [confirmReal, setConfirmReal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void findDevices().then((d) => {
      if (!live) return;
      setDevices(d);
      setOpts((o) => ({ ...o, devices: d.cameras.length + d.mics.length > 0 }));
    });
    return () => {
      live = false;
    };
  }, []);

  const env: TestEnv = useMemo(
    () => ({
      cameras: devices?.cameras ?? [],
      mics: devices?.mics ?? [],
      ffmpeg: broadcast?.status.ffmpeg ?? false,
      jewishTools: jewishToolsOn(show),
      stingers: show.settings.stingers.filter((s) => s.path).length,
      captionsReady: show.captions.on,
      vertical: broadcast ? wantsVertical(broadcast.settings) : false,
    }),
    [devices, broadcast, show],
  );
  const plan = useMemo(() => planInputs(opts, env), [opts, env]);
  const blocked = !isInsideLumora()
    ? 'The test event runs in Lumora itself, not in the browser demo.'
    : (unifiedBlocksTestEvent() ?? cannotStart(broadcast?.status));
  const ownDestinations = (broadcast?.settings.destinations ?? []).filter((d) => d.enabled && d.url.trim() && !d.vertical);
  const realReady = !opts.realDestination || confirmReal;

  const start = useCallback(async () => {
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStage({ kind: 'running', progress: null });
    const startedAt = Date.now();
    const [system, appVersion] = await Promise.all([invoke<SystemInfo>('test_event_system').catch(() => null), getVersion().catch(() => 'unknown')]);
    try {
      const r = await runTestEvent(opts, env, {
        client,
        broadcast: () => latest.current.broadcast as BroadcastApi | null,
        show: () => latest.current.show,
        levels: () => latest.current.sound?.levels ?? null,
        problems: () => problems?.snapshot() ?? [],
        onProgress: (p) => setStage((s) => (s.kind === 'running' ? { kind: 'running', progress: p } : s)),
        signal: ctrl.signal,
      });
      const judged = judge(r.measured);
      const s = r.settings;
      const data: ReportData = {
        meta: {
          appVersion,
          build: `${import.meta.env.MODE}${import.meta.env.VITE_LUMORA_E2E === '1' ? ', test build' : ''}`,
          startedAt,
          finishedAt: Date.now(),
          system,
          options: opts,
          settings: s
            ? {
                quality: s.quality,
                videoKbps: s.videoKbps,
                audioKbps: s.audioKbps,
                recordMix: s.recordMix,
                iso: s.iso,
                chapters: s.chapters,
                destinations: s.destinations.filter((d) => d.enabled).map((d) => d.name),
                encoder: s.encoder ?? 'auto',
                preset: s.preset ?? 'balanced',
                streamQuality: s.streamQuality ?? null,
                recordEncode: s.recordEncode ?? false,
              }
            : null,
          inputs: r.inputs,
          skipped: r.skipped,
        },
        measured: r.measured,
        judged,
      };
      setStage({ kind: 'report', data, markdown: buildMarkdown(data), json: buildJson(data) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ kind: 'setup' });
    } finally {
      abort.current = null;
    }
  }, [opts, env, client, problems]);

  const running = stage.kind === 'running';
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, running]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Test event">
      <div className="modal__box te">
        <header className="modal__head">
          <h2>
            <BrandMark className="modal__icon" />
            Test event
          </h2>
          {!running && (
            <button type="button" className="icon" aria-label="Close" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          )}
        </header>
        {stage.kind === 'setup' && (
          <div className="te__body">
            <p className="te__lead">
              Lumora runs a whole event by itself — every kind of input, cuts and transitions, titles, the output screens, recording and a stream to this
              computer — and tells you whether this computer is ready for a real one. Your own event is put aside first and comes back exactly as it was.
            </p>
            <fieldset className="te__group">
              <legend>How long</legend>
              <div className="te__lengths" role="radiogroup" aria-label="How long">
                {(Object.keys(LENGTHS) as TestLength[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={opts.length === l}
                    className={`te__length${opts.length === l ? ' is-on' : ''}`}
                    onClick={() => setOpts({ ...opts, length: l })}
                  >
                    <strong>{LENGTHS[l].name}</strong>
                    <span>{LENGTHS[l].minutes} min</span>
                    <small>{LENGTHS[l].hint}</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="te__group">
              <legend>What to include</legend>
              <Check on={opts.devices} set={(v) => setOpts({ ...opts, devices: v })} disabled={!devices}>
                Use my cameras and microphones{' '}
                <span className="te__dim">
                  {devices
                    ? `(${env.cameras.length} camera${env.cameras.length === 1 ? '' : 's'}, ${env.mics.length} microphone${env.mics.length === 1 ? '' : 's'} found)`
                    : '(looking…)'}
                </span>
              </Check>
              <Check on={opts.outputs} set={(v) => setOpts({ ...opts, outputs: v })}>
                Test the output screens{' '}
                <span className="te__dim">(Live, Back, Monitor and the multiview; small windows if no extra screens are connected)</span>
              </Check>
              <Check on={opts.stream} set={(v) => setOpts({ ...opts, stream: v })} disabled={!env.ffmpeg}>
                Test streaming <span className="te__dim">(to a receiver on this computer — nothing goes online; your destinations are only checked)</span>
              </Check>
              <Check on={opts.userDrive} set={(v) => setOpts({ ...opts, userDrive: v })}>
                Record to the drive I record to <span className="te__dim">(measures its real speed; the test file is removed after)</span>
              </Check>
              {opts.stream && ownDestinations.length > 0 && (
                <div className="te__real">
                  <Check
                    on={opts.realDestination !== null}
                    set={(v) => {
                      setConfirmReal(false);
                      setOpts({ ...opts, realDestination: v ? ownDestinations[0]!.id : null });
                    }}
                  >
                    Also send a short test (30 s) to my real stream destination
                  </Check>
                  {opts.realDestination !== null && (
                    <div className="te__realbox">
                      <label className="field">
                        <span className="field__label">Destination</span>
                        <select className="text" value={opts.realDestination} onChange={(e) => setOpts({ ...opts, realDestination: e.target.value })}>
                          {ownDestinations.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="field__note field__note--warn">
                        This goes out for real. Viewers may see it unless the event on that platform is set to private or unlisted.
                      </p>
                      <Check on={confirmReal} set={setConfirmReal}>
                        I understand: send 30 seconds of the test picture there
                      </Check>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
            <details className="te__plan">
              <summary>
                {plan.inputs.length} inputs will be added{plan.skipped.length ? `, ${plan.skipped.length} left out` : ''}
              </summary>
              <ul>
                {plan.inputs.map((i) => (
                  <li key={i.id}>{i.name}</li>
                ))}
                {plan.skipped.map((s) => (
                  <li key={s.what} className="te__dim">
                    {s.what}: {s.why}
                  </li>
                ))}
              </ul>
            </details>
            {(error || blocked) && <p className="field__note field__note--warn">{error ?? blocked}</p>}
            <footer className="modal__foot">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" disabled={!!blocked || !devices || !realReady} onClick={() => void start()}>
                Start the test
              </button>
            </footer>
          </div>
        )}
        {stage.kind === 'running' && <Running progress={stage.progress} stopping={!!abort.current?.signal.aborted} onStop={() => abort.current?.abort()} />}
        {stage.kind === 'report' && <Report data={stage.data} markdown={stage.markdown} json={stage.json} onClose={onClose} />}
      </div>
    </div>
  );
}

function Check({ on, set, disabled, children }: { on: boolean; set: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={`te__check${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Running({ progress, stopping, onStop }: { progress: Progress | null; stopping: boolean; onStop: () => void }) {
  const [asked, setAsked] = useState(false);
  const p = progress;
  const s = p?.sample;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [p?.steps.length]);
  return (
    <div className="te__body">
      <div className="te__now">
        <span className="te__live" aria-hidden="true" />
        <strong>{p?.current ?? 'Getting ready'}</strong>
        <span className="te__dim">
          {mmss(p?.elapsedMs ?? 0)} of about {mmss(p?.plannedMs ?? 0)}
        </span>
      </div>
      <progress className="te__bar" value={p?.done ?? 0} max={1} aria-label="Test progress" />
      <dl className="te__stats">
        <div>
          <dt>Frame rate</dt>
          <dd>{s?.fps != null ? `${s.fps} / ${s.target}` : '–'}</dd>
        </div>
        <div>
          <dt>Dropped</dt>
          <dd>{s?.dropped ?? '–'}</dd>
        </div>
        <div>
          <dt>Encoder</dt>
          <dd>{s?.recSpeed != null ? `${s.recSpeed.toFixed(2)}×` : '–'}</dd>
        </div>
        <div>
          <dt>Processor</dt>
          <dd>{s?.cpu != null ? `${Math.round(s.cpu)}%` : '–'}</dd>
        </div>
        <div>
          <dt>Lumora memory</dt>
          <dd>{s?.appMemMb != null ? `${s.appMemMb} MB` : '–'}</dd>
        </div>
      </dl>
      <ol className="te__timeline" ref={list}>
        {(p?.steps ?? []).map((st, i) => (
          <li key={i} className={st.ok ? 'is-ok' : st.skipped ? 'is-skip' : st.error ? 'is-bad' : 'is-now'}>
            <span className="te__time">{mmss(st.at)}</span>
            <span>{st.label}</span>
            <span className="te__dim">{st.error ?? st.notes.join('; ')}</span>
          </li>
        ))}
      </ol>
      <p className="field__note">Your own event is safe: it comes back when the test ends, even if Lumora closes in the middle.</p>
      <footer className="modal__foot">
        {asked || stopping ? (
          <span className="te__dim">Stopping — putting your event back…</span>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAsked(true);
              onStop();
            }}
          >
            <Square aria-hidden="true" /> Stop the test
          </button>
        )}
      </footer>
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className={`te__finding te__finding--${f.severity}`}>
      <span className="te__sev">{SEVERITY_LABEL[f.severity]}</span>
      <div>
        <strong>{f.title}</strong>
        {f.detail && <p>{f.detail}</p>}
        <p className="te__advice">{f.advice}</p>
        <details>
          <summary>For the developer</summary>
          <p className="te__dim">{f.where}</p>
        </details>
      </div>
    </li>
  );
}

function Report({ data, markdown, json, onClose }: { data: ReportData; markdown: string; json: string; onClose: () => void }) {
  const { judged: j, measured: m } = data;
  const v = VERDICT_WORDS[j.verdict];
  const st = j.stats;
  const [saved, setSaved] = useState<{ markdown: string; json: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setMsg(e instanceof Error ? e.message : String(e));
  const save = useCallback(
    () =>
      invoke<{ markdown: string; json: string }>('test_event_save_report', { name: reportName(new Date(data.meta.startedAt)), markdown, json }).then(
        setSaved,
        (e: unknown) => setMsg(`The report could not be saved: ${String(e)}`),
      ),
    [data, markdown, json],
  );
  useEffect(() => {
    void save();
  }, [save]);
  const openIt = (reveal: boolean) => saved && void invoke('test_event_open_report', { path: saved.markdown, reveal }).catch(fail);
  const copy = () =>
    void navigator.clipboard.writeText(markdown).then(
      () => setMsg('Copied. Paste it wherever you like.'),
      () => setMsg('Could not copy. Use Open report instead.'),
    );
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const head = `Test event report: ${v.word}. ${j.findings.length} finding(s).\n\n`;
      await sendProblemReport({ description: (head + markdown).slice(0, 3900), screenshot: null, logs: true });
      setMsg('Sent to the Lumora team. Thank you.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="te__body">
      <div className={`te__verdict te__verdict--${j.verdict}`}>
        <span className="te__verdict-word">{v.word}</span>
        <p>{v.line}</p>
      </div>
      <section>
        <h3>Problems</h3>
        {j.findings.length ? (
          <ul className="te__findings">
            {j.findings.map((f, i) => (
              <FindingRow key={i} f={f} />
            ))}
          </ul>
        ) : (
          <p className="te__dim">None found.</p>
        )}
      </section>
      {j.advice.length > 0 && (
        <section>
          <h3>Good to know</h3>
          <ul className="te__list">
            {j.advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <dl className="te__stats">
        <div>
          <dt>Frame rate</dt>
          <dd>
            {st.fpsAvg ?? '–'} avg / {st.fpsMin ?? '–'} min
          </dd>
        </div>
        <div>
          <dt>Dropped frames</dt>
          <dd>{st.droppedPct ?? '–'}%</dd>
        </div>
        <div>
          <dt>Processor max</dt>
          <dd>{st.cpuMax ?? '–'}%</dd>
        </div>
        <div>
          <dt>Memory growth</dt>
          <dd>{st.memGrowthMb ?? '–'} MB</dd>
        </div>
        <div>
          <dt>Encoder</dt>
          <dd>{st.recSpeedAvg ?? '–'}×</dd>
        </div>
        <div>
          <dt>Drive</dt>
          <dd>{st.diskMBps ?? '–'} MB/s</dd>
        </div>
      </dl>
      {m.outputsTested && (
        <details className="te__section">
          <summary>Output screens</summary>
          <p className="te__dim">
            {m.extraDisplays === 0
              ? 'No extra screens connected — outputs tested as windows on the main screen.'
              : `${m.extraDisplays} extra screen(s) connected.`}
          </p>
          <ul className="te__list">
            {m.outputs.map((o) => (
              <li key={o.output}>
                <strong>{outputOk(o) ? 'Pass' : 'Fail'}</strong> — {OUTPUT_NAMES[o.output]}:{' '}
                {o.opened ? `${o.fps ?? '?'} fps${o.inSync === false ? ', out of step' : ''}${o.black ? ', black' : ''}` : 'did not open'}
              </li>
            ))}
            <li>Full screen: {m.fullscreenOk === null ? 'not tried' : m.fullscreenOk ? 'worked' : 'did not work'}</li>
          </ul>
        </details>
      )}
      {(m.streams.length > 0 || m.preflight.length > 0) && (
        <details className="te__section">
          <summary>Streaming</summary>
          <ul className="te__list">
            {m.streams.map((s, i) => (
              <li key={i}>
                {s.vertical ? 'Vertical' : 'Wide'} → {s.local ? 'test receiver on this computer' : s.name}:{' '}
                {s.started ? `${s.probe?.frames ?? '?'} frames received, ${s.reconnects} reconnects` : `did not start${s.error ? ` (${s.error})` : ''}`}
              </li>
            ))}
            {m.preflight.map((r) => (
              <li key={r.name}>
                {r.name}: {r.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="te__section">
        <summary>Timeline</summary>
        <ol className="te__timeline te__timeline--report">
          {m.steps.map((s, i) => (
            <li key={i} className={s.ok ? 'is-ok' : s.skipped ? 'is-skip' : 'is-bad'}>
              <span className="te__time">{mmss(s.at)}</span>
              <span>{s.label}</span>
              <span className="te__dim">{s.error ?? s.notes.join('; ')}</span>
            </li>
          ))}
        </ol>
      </details>
      <details className="te__section">
        <summary>Full report (what is saved and sent)</summary>
        <pre className="te__md">{markdown}</pre>
      </details>
      {saved && <p className="field__note">Saved in Documents → Lumora → Test reports (as Markdown and JSON).</p>}
      {msg && <p className="field__note">{msg}</p>}
      <footer className="modal__foot te__foot">
        <button type="button" className="btn" disabled={!saved} onClick={() => openIt(false)}>
          <FileText aria-hidden="true" /> Open report
        </button>
        <button type="button" className="btn" disabled={!saved} onClick={() => openIt(true)}>
          <FolderOpen aria-hidden="true" /> Show in folder
        </button>
        <button type="button" className="btn" onClick={copy}>
          <Copy aria-hidden="true" /> Copy report
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
          <Send aria-hidden="true" /> {busy ? 'Sending…' : 'Send to the Lumora team'}
        </button>
        <span className="te__spacer" />
        <button type="button" className="btn btn--primary" onClick={onClose}>
          <ClipboardCheck aria-hidden="true" /> Done
        </button>
      </footer>
    </div>
  );
}
