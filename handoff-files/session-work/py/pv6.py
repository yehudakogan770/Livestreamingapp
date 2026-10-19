import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
("""  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');""",
"""  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');
  const [hidden, setHidden] = useHidden(planId);"""),
("""              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}""",
"""              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}
              hidden={hidden}"""),
("""          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button\"""",
"""          {(tab === 'run' || tab === 'chat') && <ColumnsMenu hidden={hidden} onChange={setHidden} columns={plan.columns} />}
          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button\""""),
("""  UserPlus,
  X,
} from 'lucide-react';""", """  UserPlus,
  X,
  Columns3,
} from 'lucide-react';"""),
])
