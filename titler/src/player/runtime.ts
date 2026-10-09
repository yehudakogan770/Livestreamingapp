// The script inside an exported template (built into one file by
// titler/playerPlugin.ts): the page form for CasparCG, SPX, OBS, vMix and
// H2R Graphics, and the OGraf Web Component.

import { parseTemplateData, TitlePlayer, valuesFromQuery } from './player';
import type { TitleProject, Values } from '../core/types';

type Result = { statusCode: number; statusMessage?: string; currentStep?: number };

/**
 * The page form: the title fills the window, and the playout system calls the
 * usual functions on the window:
 *   CasparCG / SPX: play(), stop(), next(), update(data), remove()
 *   SPX also: runTemplateUpdate()
 *   OBS / vMix browser sources: ?name=Ada&autoplay=1 in the address
 *   Anything else: window.postMessage({ lumoraTitle: 'play' | 'stop' | 'update', data })
 */
export function page(project: TitleProject): TitlePlayer {
  const host = document.getElementById('title') ?? document.body;
  const player = new TitlePlayer(host, project);
  const w = window as unknown as Record<string, unknown>;
  const query = valuesFromQuery(location.search, player.project);
  const q = new URLSearchParams(location.search);
  void player.load(query).then(() => {
    if (q.get('autoplay') === '1' || q.get('play') === '1') void player.play();
  });
  const update = (data: unknown) => player.update(parseTemplateData(data));
  w.play = () => void player.play();
  w.stop = () => void player.stop();
  w.next = () => void (player.state() === 'off' || player.state() === 'done' ? player.play() : player.stop());
  w.update = update;
  w.remove = () => player.clear();
  // SPX: the field values are already set on the page by update(); it then calls this.
  w.runTemplateUpdate = () => player.draw();
  w.lumoraTitle = player;
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { lumoraTitle?: string; data?: unknown } | null;
    if (!m || typeof m !== 'object' || typeof m.lumoraTitle !== 'string') return;
    if (m.lumoraTitle === 'play') void player.play();
    else if (m.lumoraTitle === 'stop') void player.stop();
    else if (m.lumoraTitle === 'update') update(m.data);
    else if (m.lumoraTitle === 'clear') player.clear();
  });
  addEventListener('resize', () => player.draw());
  return player;
}

/** The OGraf Web Component class for a title (EBU OGraf v1: one step, real time and non-real time). */
export function ograf(project: TitleProject): CustomElementConstructor {
  return class LumoraTitleGraphic extends HTMLElement {
    private player: TitlePlayer | null = null;
    private schedule: { timestamp: number; action: { type: string; params: Record<string, unknown> } }[] = [];
    private nonRealTime = false;

    connectedCallback() {
      this.style.position = this.style.position || 'absolute';
      if (!this.style.inset) this.style.inset = '0';
    }

    async load(params: { data?: unknown; renderType?: string; renderCharacteristics?: { resolution?: { width: number; height: number } } }): Promise<Result> {
      const res = params.renderCharacteristics?.resolution;
      this.nonRealTime = params.renderType === 'non-realtime';
      let t = 0;
      this.player = new TitlePlayer(this, project, {
        width: res?.width,
        height: res?.height,
        ...(this.nonRealTime ? { now: () => t, animate: false } : {}),
      });
      if (this.nonRealTime) this.clockSet = (ms) => (t = ms);
      await this.player.load(parseTemplateData(params.data));
      return { statusCode: 200 };
    }

    private clockSet: (ms: number) => void = () => {};

    async dispose(): Promise<Result> {
      this.player?.dispose();
      this.player = null;
      return { statusCode: 200 };
    }

    async playAction(params: { goto?: number; delta?: number; skipAnimation?: boolean } = {}): Promise<Result> {
      const p = this.player;
      if (!p) return { statusCode: 400, statusMessage: 'Not loaded' };
      const on = p.state() !== 'off' && p.state() !== 'done' && p.state() !== 'out';
      const target = params.goto !== undefined && params.goto >= 0 ? params.goto : (on ? 0 : -1) + (params.delta ?? 1);
      if (target >= 1) {
        await p.stop(params.skipAnimation);
        return { statusCode: 200, currentStep: undefined };
      }
      await p.play(params.skipAnimation);
      return { statusCode: 200, currentStep: 0 };
    }

    async stopAction(params: { skipAnimation?: boolean } = {}): Promise<Result> {
      await this.player?.stop(params.skipAnimation);
      return { statusCode: 200 };
    }

    async updateAction(params: { data?: unknown } = {}): Promise<Result> {
      this.player?.update(parseTemplateData(params.data) as Values);
      return { statusCode: 200 };
    }

    async customAction(): Promise<Result> {
      return { statusCode: 404, statusMessage: 'This graphic has no custom actions' };
    }

    async setActionsSchedule(params: { schedule?: { timestamp: number; action: { type: string; params: Record<string, unknown> } }[] }): Promise<Result> {
      this.schedule = [...(params.schedule ?? [])].sort((a, b) => a.timestamp - b.timestamp);
      return { statusCode: 200 };
    }

    /** Non-real time: replay the schedule up to `timestamp` (ms), then draw that frame. */
    async goToTime(params: { timestamp: number }): Promise<Result> {
      const p = this.player;
      if (!p) return { statusCode: 400, statusMessage: 'Not loaded' };
      p.clear();
      for (const s of this.schedule) {
        if (s.timestamp > params.timestamp) break;
        this.clockSet(s.timestamp);
        const a = s.action;
        if (a.type === 'playAction') void p.play(!!a.params?.skipAnimation);
        else if (a.type === 'stopAction') void p.stop(!!a.params?.skipAnimation);
        else if (a.type === 'updateAction') p.update(parseTemplateData(a.params?.data));
      }
      this.clockSet(params.timestamp);
      p.draw();
      return { statusCode: 200 };
    }
  };
}

const api = { page, ograf };
(globalThis as unknown as { LumoraTitleRuntime: typeof api }).LumoraTitleRuntime = api;

