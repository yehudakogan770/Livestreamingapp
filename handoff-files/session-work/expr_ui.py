import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Inspector.tsx', [
("""  const p = getProp(layer, path);
  const anim = isAnimated(p);
  const v = valueAt(p as never, time, fallback as never) as Value;
  const set = (nv: Value) =>
    store.edit(`Change ${label.toLowerCase()}`, (pr) =>
      updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, setValue(getProp(x, path) as never, time, nv as never))),
    );
  return (
    <Row label={label}>""", """  const p = getProp(layer, path);
  const anim = isAnimated(p);
  const v = valueAt(p as never, time, fallback as never) as Value;
  const expr = p?.x;
  const [exprOpen, setExprOpen] = useState(false);
  const set = (nv: Value) =>
    store.edit(`Change ${label.toLowerCase()}`, (pr) =>
      updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, setValue(getProp(x, path) as never, time, nv as never))),
    );
  const setExpr = (x: string | null) =>
    store.edit(x === null ? `Remove expression from ${label.toLowerCase()}` : `Expression on ${label.toLowerCase()}`, (pr) =>
      updateLayers(pr, compId, [layer.id], (l) => {
        const cur = (getProp(l, path) ?? { v: fallback }) as Prop<Value>;
        const { x: _old, ...rest } = cur;
        return withProp(l, path, (x === null ? rest : { ...rest, x }) as never);
      }),
    );
  return (
    <>
    <Row label={label}>"""),
("""          onEnd={() => store.end()}
          wide
        />
      )}
    </Row>
  );
}

interface Common {""", """          onEnd={() => store.end()}
          wide
        />
      )}
      <button
        className={`tt-ico tt-expr-btn${expr ? ' on' : ''}`}
        onClick={() => setExprOpen(!exprOpen && !expr ? true : !exprOpen)}
        title={expr ? `Expression: ${expr}` : 'Add an expression (wiggle, loop, time, a link to another layer)'}
        aria-label={`Expression for ${label}`}
        aria-pressed={!!expr}
      >
        =
      </button>
    </Row>
    {(exprOpen || !!expr) && <ExprEditor label={label} value={expr ?? ''} open={exprOpen} onOpen={setExprOpen} onChange={setExpr} />}
    </>
  );
}

const EXPR_EXAMPLES: [string, string][] = [
  ['wiggle(2, 8)', 'Shake: 2 times a second, 8 px'],
  ['loopOut()', 'Repeat the keyframes'],
  ['loopOut("pingpong")', 'Back and forth'],
  ['time * 90', 'Keep turning (90° a second)'],
  ['value + [0, sin(time * 3) * 10]', 'Float up and down'],
];

/** An expression under a property: type it, see if it works, pick an example. */
function ExprEditor({
  label,
  value,
  open,
  onOpen,
  onChange,
}: {
  label: string;
  value: string;
  open: boolean;
  onOpen: (o: boolean) => void;
  onChange: (x: string | null) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const problem = text.trim() ? exprProblem(text) : null;
  if (!open)
    return (
      <div className="tt-expr tt-expr-closed">
        <button className="tt-expr-code" onClick={() => onOpen(true)} title="Change the expression">
          = {value}
        </button>
      </div>
    );
  const commit = () => {
    if (!text.trim()) onChange(null);
    else if (!problem && text !== value) onChange(text.trim());
  };
  return (
    <div className="tt-expr">
      <input
        className="tt-input tt-expr-input"
        autoFocus
        value={text}
        placeholder="wiggle(2, 8)"
        aria-label={`${label} expression`}
        aria-invalid={!!problem}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            onOpen(false);
          }
          if (e.key === 'Escape') {
            setText(value);
            onOpen(false);
          }
        }}
      />
      {problem ? <div className="tt-expr-problem">{problem}</div> : null}
      <div className="tt-chips">
        {EXPR_EXAMPLES.map(([x, hint]) => (
          <button key={x} className="tt-chip" title={hint} onMouseDown={(e) => e.preventDefault()} onClick={() => (setText(x), onChange(x))}>
            {x}
          </button>
        ))}
        {value && (
          <button className="tt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(null), onOpen(false))}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

interface Common {"""),
("import { useState, type ReactElement } from 'react';", "import { useEffect, useState, type ReactElement } from 'react';\nimport { exprProblem } from '../core/expr';"),
("import type { Effect, ImageLayer, VideoLayer, Layer, Mask, Paint, ShapeLayer, Stroke, TextAnimator, TextLayer, Value, Vec2 } from '../core/types';",
 "import type { Effect, ImageLayer, VideoLayer, Layer, Mask, Paint, Prop, ShapeLayer, Stroke, TextAnimator, TextLayer, Value, Vec2 } from '../core/types';"),
])

edit('titler/src/designer/Designer.tsx', [
("""  // Audio cues sound as the preview passes them.""", """  // Expressions' links find layers in this title (hit tests and handles too, not only drawing).
  useEffect(() => {
    setExprScope(exprScopeFor(project));
  }, [project]);

  // Audio cues sound as the preview passes them."""),
("import { RamPreview } from './ramPreview';", "import { RamPreview } from './ramPreview';\nimport { setExprScope } from '../core/expr';\nimport { exprScopeFor } from '../core/render';"),
])
s = open('titler/src/designer/designer.css').read()
s += '''
/* Expressions under a property. */
.tt-expr-btn {
  font: 600 12px var(--tt-mono);
  color: var(--tt-faint);
}
.tt-expr-btn.on {
  color: var(--tt-text);
}
.tt-expr {
  margin: -2px 0 6px 100px;
}
.tt-expr-input {
  width: 100%;
  font-family: var(--tt-mono);
}
.tt-expr-input[aria-invalid='true'] {
  border-color: #b4553a;
}
.tt-expr-problem {
  margin-top: 3px;
  font-size: 11px;
  color: #d8826a;
}
.tt-expr-code {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 11px var(--tt-mono);
  color: var(--tt-dim);
  text-align: left;
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
