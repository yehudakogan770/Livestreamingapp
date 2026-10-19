import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


rep("""      .tag {""", """      .reacts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .react {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin: 0;
        padding: 16px 8px 12px;
        text-align: center;
        touch-action: manipulation;
        -webkit-user-select: none;
        user-select: none;
        transition: transform 80ms ease-out;
      }
      .react:active {
        transform: scale(0.96);
      }
      .react svg {
        width: 52px;
        height: 52px;
      }
      .react .pop {
        position: absolute;
        top: 8px;
        left: 50%;
        width: 28px;
        height: 28px;
        margin-left: -14px;
        pointer-events: none;
        animation: rise 700ms ease-out forwards;
      }
      @keyframes rise {
        from {
          opacity: 1;
          transform: translateY(0) scale(0.8);
        }
        to {
          opacity: 0;
          transform: translateY(-60px) scale(1.1);
        }
      }
      .tag {""")
rep("""        const seating = a.seating || [];""", """        const seating = a.seating || [];
        const reactions = a.reactions || [];""")
rep("""        const open = a.polls.length || a.questions || raffles.length || funds.length || walls.length || auctions.length || games.length || seating.length;""",
    """        const open =
          a.polls.length ||
          a.questions ||
          raffles.length ||
          funds.length ||
          walls.length ||
          auctions.length ||
          games.length ||
          seating.length ||
          reactions.length;""")
rep("""        for (const r of raffles) {""", """        for (const rx of reactions) {
          const grid = el('div', { className: 'reacts' });
          REACTIONS.forEach(([name, svg], kind) => {
            const b = el('button', { className: 'react', ariaLabel: name });
            b.innerHTML = svg;
            b.append(el('span', { textContent: name }));
            b.onclick = () => reactIt(rx, kind, b, svg);
            grid.append(b);
          });
          app.append(el('section', { className: 'poll' }, el('h1', { textContent: 'React' }), grid, el('p', { className: 'note', textContent: 'Tap as often as you like: your reactions rise on the screen.' })));
        }
        for (const r of raffles) {""")
rep("""      // Question votes this phone made, until the page hears them back.""", """      // Reactions: Love, Haha, Wow, Yes (drawn like the screen draws them).
      const badge = (color, inner) => '<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="12" fill="' + color + '"/>' + inner + '</svg>';
      const REACTIONS = [
        ['Love', badge('#e8445a', '<path fill="#fff" d="M0 6.5C-7.5 1.5-7.5-5.5-3.6-5.6-1.6-5.7-0.4-4.4 0-3 0.4-4.4 1.6-5.7 3.6-5.6 7.5-5.5 7.5 1.5 0 6.5Z"/>')],
        [
          'Haha',
          badge(
            '#f2b52c',
            '<g fill="#3a2a05"><circle cx="-3.4" cy="-2.8" r="1.4"/><circle cx="3.4" cy="-2.8" r="1.4"/></g><path d="M-4.4 2.2A4.6 4.6 0 0 0 4.4 2.2" fill="none" stroke="#3a2a05" stroke-width="1.8" stroke-linecap="round"/>',
          ),
        ],
        ['Wow', badge('#f2b52c', '<g fill="#3a2a05"><circle cx="-3.4" cy="-2.8" r="1.4"/><circle cx="3.4" cy="-2.8" r="1.4"/><ellipse cy="3.6" rx="2.2" ry="2.8"/></g>')],
        ['Yes', badge('#2ea56a', '<path d="M-5 0.5-1.5 4 5.5-3.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')],
      ];

      function reactIt(rx, kind, button, svg) {
        const pop = el('span', { className: 'pop' });
        pop.innerHTML = svg;
        button.append(pop);
        setTimeout(() => pop.remove(), 800);
        if (navigator.vibrate) navigator.vibrate(10);
        fetch('/api/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: rx.id, kind, voter }),
        }).catch(() => {});
      }

      // Question votes this phone made, until the page hears them back.""")
open(p, 'w').write(s)
print('ok')
