import sys
p = sys.argv[1]
s = open(p).read()
start = s.index('/** Audience questions from phones: show one on screen, or let it go. */')
s = s[:start] + open(sys.argv[2]).read()
s = s.replace(
    "        <Questions show={show} act={act} card={card?.id ?? null} remote={remote} onRemote={() => void client.setRemote(true)} />",
    "        <Questions show={show} act={act} card={card?.id ?? null} remote={remote} onRemote={() => void client.setRemote(true)} client={client} />",
)
s = s.replace("import { X } from 'lucide-react';", "import { Download, Play, Square, ThumbsUp, X } from 'lucide-react';")
s = s.replace(
    "import './ChatPanel.css';",
    "import { sortQuestions, type QuestionOrder } from '../engine/questions';\nimport { csvName, questionRows, toCsv } from '../engine/audienceExport';\nimport './ChatPanel.css';",
)
# The tab count: questions not yet answered (and those waiting).
s = s.replace(
    "            Questions{show.qna?.questions.filter((q) => !q.shown).length ? ` (${show.qna.questions.filter((q) => !q.shown).length})` : ''}",
    "            Questions{show.qna?.questions.filter((q) => !q.shown).length ? ` (${show.qna.questions.filter((q) => !q.shown).length})` : ''}",
)
open(p, 'w').write(s)
print('ok')
