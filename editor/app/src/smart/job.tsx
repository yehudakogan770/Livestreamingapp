// Running a smart tool's job with progress and a Stop button (shared by the Smart dialogs).
import { useEffect, useRef, useState } from 'react';
import { Stopped, type Job } from './analysis';

export interface Running {
  done: number;
  message: string;
}

export function useJob() {
  const [running, setRunning] = useState<Running | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const onStop = useRef<(() => void) | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async <T,>(f: (job: Job) => Promise<T>, stop?: () => void): Promise<T | null> => {
    const c = new AbortController();
    ctl.current = c;
    onStop.current = stop ?? null;
    setProblem(null);
    setRunning({ done: 0, message: 'Starting…' });
    try {
      return await f({ signal: c.signal, progress: (done, message) => !c.signal.aborted && setRunning({ done, message }) });
    } catch (e) {
      if (!(e instanceof Stopped)) setProblem(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      ctl.current = null;
      setRunning(null);
    }
  };
  const stop = () => {
    ctl.current?.abort();
    onStop.current?.();
  };
  return { running, problem, run, stop };
}

export function Progress({ running, onStop }: { running: Running; onStop: () => void }) {
  return (
    <div className="expo">
      <p className="expo__msg">{running.message}</p>
      <div className="expo__bar">
        <i style={{ width: `${Math.round(Math.min(1, Math.max(0, running.done)) * 100)}%` }} />
      </div>
      <div className="form__foot">
        <button type="button" className="btn" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}
