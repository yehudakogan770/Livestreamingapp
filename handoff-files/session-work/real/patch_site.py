import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("c.fillText('Sarah Mitchell', x + 22, y + 32);", "c.fillText('Daniel Brooks', x + 22, y + 32);")
rep("c.fillText('Keynote speaker', x + 22, y + 53);", "c.fillText('Chief Product Officer · Northwind', x + 22, y + 53);")
rep("""    const img = st.backLive ? program : frames[3];
    c.drawImage(img, 0, (H - 270) / 2, W, 270, 0, 0, 640, 270);""", """    if (st.backLive) {
      c.drawImage(program, 0, (H - 270) / 2, W, 270, 0, 0, 640, 270);
      return;
    }
    // The slides, whole, in the middle of the wide projector screen.
    c.fillStyle = '#0b0c0f';
    c.fillRect(0, 0, 640, 270);
    c.drawImage(frames[3], 80, 0, 480, 270);""")
rep("""    texts(now);
    if (!visible.size) return;
    const t = now / 1000;
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d'), t));""", """    texts(now);
    // The clips only play while some of this can be seen.
    if (!visible.size) {
      SOURCES.forEach((s) => s.pause());
      return;
    }
    SOURCES.forEach((s) => s.play());
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d')));""")
rep("""    // One still picture of each, no movement.
    const t = 12;
    SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d'), t));
    const redraw = () => {
""", """    // One still picture of each, no movement.
    const redraw = () => {
      SOURCES.forEach((s, i) => s.draw(frames[i].getContext('2d')));
""")
rep("""    redraw();
    document.addEventListener('click', () => setTimeout(redraw, 0));""", """    redraw();
    SOURCES.forEach((s) => s.poster.addEventListener('load', redraw));
    document.addEventListener('click', () => setTimeout(redraw, 0));""")
open(p, 'w').write(s)
