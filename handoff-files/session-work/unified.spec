@@@
  adapter: { name: string; backend: string; kind: string } | null;
  outputs: string[];
  feed: EngineFeedStats | null;
  /** Every feed: the recording, the stream, the vertical version, NDI (screens) and each camera's ISO file (inputs). */
  feeds: { id: number; kind: 'screen' | 'vertical' | 'input'; stats: EngineFeedStats | null; error: string | null }[];
===
  /** The graphics card it draws with (`key`: Settings → Engine's choice; `choice`: why this one). */
  adapter: { name: string; backend: string; kind: string; key?: string; choice?: string } | null;
  outputs: string[];
  /** Each output window: the card that drives its display, the one that presents it, and its colors. */
  outputCards?: EngineOutputCard[];
  /** Every graphics card here (with the displays it drives, on Windows). */
  cards?: EngineCard[];
  feed: EngineFeedStats | null;
  /**
   * Every feed: the recording, the stream, the vertical version, NDI (screens) and each camera's ISO file (inputs).
   * `route`: how a screen's picture reaches its encoder (handed over on the graphics card, or read back, and why).
   */
  feeds: {
    id: number;
    kind: 'screen' | 'vertical' | 'input';
    stats: EngineFeedStats | null;
    error: string | null;
    route?: { zeroCopy: boolean; path: string } | null;
  }[];
@@@
export interface EngineInfo {
  mode: EngineMode;
===
/** A graphics card the engine can use. */
export interface EngineCard {
  key: string;
  name: string;
  backend: string;
  kind: string;
  /** Desktop rectangles of the displays it drives: x, y, width, height. */
  displays: [number, number, number, number][];
}

/** An output window of the engine: which card shows it and how. */
export interface EngineOutputCard {
  output: string;
  displayCard: string | null;
  presentedBy: string;
  /** The engine copies the picture to the display's own card. */
  copied: boolean;
  /** "SDR", or the HDR mode it shows now. */
  color: string;
}

/** Settings → Engine: the graphics card and each output's presentation. */
export interface EngineOptions {
  /** A card's key; null: the high-performance card (automatic). */
  adapter: string | null;
  /** Outputs (live, back, monitor, multiview) presented by their display's own card. */
  ownCard: string[];
  /** Outputs shown in HDR10 when their display shows HDR. */
  hdr: string[];
  /** SDR white in HDR outputs (nits). */
  sdrWhite: number;
}

export interface EngineInfo {
  mode: EngineMode;
@@@
  /** The engine shows the Live and Back Screens in its own windows (Windows). */
  nativeOutputs: boolean;
}
===
  /** The engine shows the Live and Back Screens in its own windows (Windows). */
  nativeOutputs: boolean;
  options?: EngineOptions;
}
@@@
export async function setEngineMode(mode: EngineMode): Promise<EngineInfo> {
===
/** Settings → Engine's graphics card and output choices (a new card restarts the engine on it). */
export async function setEngineOptions(options: EngineOptions): Promise<EngineInfo> {
  const i = await invoke<EngineInfo>('live_engine_set_options', { options });
  set(i);
  return i;
}

export async function setEngineMode(mode: EngineMode): Promise<EngineInfo> {
