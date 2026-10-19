import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('planner/src/offlineCache.ts', [
("""  blocks?: Block[];""", """  blocks?: Block[];
  /** The lists (crew, contacts, tasks, gear, budget). */
  items?: Item[];"""),
("""import type { Block } from './blocks';""", """import type { Block } from './blocks';
import type { Item } from './items';"""),
])

apply('planner/src/useItems.ts', [
("""import { db } from './session';""", """import { db } from './session';
import { rememberPlan, savedPlan, unreachable } from './offlineCache';"""),
("""      .catch((e: unknown) => {
        if (!live) return;
        const m = e instanceof Error ? e.message : String(e);
        if (/update-10/.test(m)) setReady(false);
        else setError(m);
        setLoaded(true);
      });""", """      .catch((e: unknown) => {
        if (!live) return;
        const m = e instanceof Error ? e.message : String(e);
        // No internet: the copy kept on this device.
        const copy = unreachable(e) ? savedPlan(planId)?.items : undefined;
        if (copy) {
          setItems(copy);
          fromCopy.current = true;
        } else if (/update-10/.test(m)) setReady(false);
        else setError(m);
        setLoaded(true);
      });"""),
("""  const dirty = useRef(new Map<string, number>());""", """  const dirty = useRef(new Map<string, number>());
  const fromCopy = useRef(false);"""),
("""  const flush = useCallback(async () => {""", """  // A copy on this device, for when there is no internet.
  useEffect(() => {
    if (!loaded || fromCopy.current || !ready) return;
    const t = setTimeout(() => rememberPlan(planId, { items }), 800);
    return () => clearTimeout(t);
  }, [planId, items, loaded, ready]);

  const flush = useCallback(async () => {"""),
])
