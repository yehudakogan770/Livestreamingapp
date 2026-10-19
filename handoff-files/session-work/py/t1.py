import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

MOCKS = """vi.mock('./session', () => ({ db: () => ({}) }));
vi.mock('./useLive', async (orig) => ({ ...(await orig<typeof import('./useLive')>()), useLive: () => (await import('./testStores')).liveStore }));
"""
for f in ['planner/src/PlanView.test.tsx', 'planner/src/PhonePlan.test.tsx']:
    apply(f, [("""vi.mock('./session', () => ({ db: () => ({}) }));
""", """vi.mock('./session', () => ({ db: () => ({}) }));
const stores = await import('./testStores');
vi.mock('./useLive', async (orig) => ({ ...(await orig<typeof import('./useLive')>()), useLive: () => stores.liveStore }));
vi.mock('./useItems', async (orig) => ({ ...(await orig<typeof import('./useItems')>()), useItems: () => stores.itemStore }));
vi.mock('./Files', async (orig) => ({ ...(await orig<typeof import('./Files')>()), useFiles: () => stores.fileStore }));
vi.mock('./usePeople', async (orig) => ({ ...(await orig<typeof import('./usePeople')>()), usePeople: () => [] }));
vi.mock('./apiPro', async (orig) => ({ ...(await orig<typeof import('./apiPro')>()), loadLocks: async () => [], watchLocks: () => () => {} }));
""")])
