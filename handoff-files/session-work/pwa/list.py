import sys
p=sys.argv[1]
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("""  onCreate,
  phone = false,
}: {
  plans: PlanSummary[] | null;
  error: string;
  onRefresh: () => void;""","""  onCreate,
  phone = false,
  top,
}: {
  plans: PlanSummary[] | null;
  error: string;
  onRefresh: () => unknown;""")
rep("""  onCreate: (name: string, date: string) => Promise<void>;
  phone?: boolean;
}) {
  const [name, setName] = useState('');""","""  onCreate: (name: string, date: string) => Promise<void>;
  phone?: boolean;
  /** Above the list: the card about installing the app. */
  top?: ReactNode;
}) {
  const [name, setName] = useState('');
  const pull = usePullToRefresh<HTMLElement>(onRefresh, phone);""")
rep("""    <main className="page">
      <PageHead
        title="Plans\"""","""    <main className="page page--pull" ref={pull.ref}>
      {phone && (
        <div className={`pull${pull.busy ? ' is-busy' : ''}`} style={{ height: pull.dist }} aria-hidden={!pull.busy} role="status">
          <LoaderCircle
            size={20}
            strokeWidth={1.75}
            className={pull.busy ? 'spin' : undefined}
            style={pull.busy ? undefined : { transform: `rotate(${(pull.dist / PULL_AT) * 270}deg)`, opacity: Math.min(1, pull.dist / PULL_AT) }}
            aria-label={pull.busy ? 'Refreshing' : undefined}
          />
        </div>
      )}
      <PageHead
        title="Plans\"""")
rep("""        phone={phone}
      />
      {canPlan && (""","""        phone={phone}
      />
      {top}
      {canPlan && (""")
open(p,'w').write(s)
