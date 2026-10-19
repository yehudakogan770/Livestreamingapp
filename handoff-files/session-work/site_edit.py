import sys
root = sys.argv[1]
p = root + '/docs/index.html'
s = open(p).read()
s = s.replace("""          <a href="#titler">Titler</a>
""", """          <a href="#titler">Titler</a>
          <a href="#photo">Photo</a>
""", 1)
section = """
      <!-- Dark: Lumora Photo. -->
      <section id="photo" class="dark studio photo">
        <div class="wrap">
          <div class="head studio__head">
            <p class="prod prod--photo"><img src="img/photo-mark.svg" alt="" width="22" height="22" />Lumora Photo <span>Photo editing and design</span></p>
            <h2 class="studio__title">Meet Lumora Photo.</h2>
            <p class="studio__sub">A full photo editor and design tool, with your Photoshop files.</p>
            <p class="studio__verbs photo__verbs"><span>Retouch.</span><span>Compose.</span><span>Share.</span></p>
          </div>
          <div class="win studio__win">
            <div class="win__bar">
              <span><img src="img/photo-mark.svg" alt="" width="14" height="14" />Lumora Photo</span><i></i><i></i><i></i>
            </div>
            <picture>
              <source
                type="image/avif"
                srcset="img/photo-640.avif 640w, img/photo-1280.avif 1280w, img/photo-1920.avif 1920w"
                sizes="(min-width: 1240px) 1200px, calc(100vw - 40px)"
              />
              <source
                type="image/webp"
                srcset="img/photo-640.webp 640w, img/photo-1280.webp 1280w, img/photo-1920.webp 1920w"
                sizes="(min-width: 1240px) 1200px, calc(100vw - 40px)"
              />
              <img
                src="img/photo.jpg"
                srcset="img/photo-640.jpg 640w, img/photo-1280.jpg 1280w, img/photo.jpg 1920w"
                sizes="(min-width: 1240px) 1200px, calc(100vw - 40px)"
                width="1920"
                height="1080"
                loading="lazy"
                decoding="async"
                alt="Lumora Photo: a photo of an event hall with a Curves adjustment layer, the curve in the Properties panel and the layers at the side."
              />
            </picture>
          </div>
          <ul class="pages pages--photo">
            <li><b>Layers</b><span>Masks, adjustment layers, blend modes, layer styles, smart objects and type, in 8, 16 or 32 bits.</span></li>
            <li><b>Retouch</b><span>Healing, clone and content-aware fill, Camera Raw, curves, and every selection tool you expect.</span></li>
            <li><b>Files</b><span>Opens and saves Photoshop files with their layers, plus PNG, JPEG, WebP, TIFF and DNG raw.</span></li>
            <li><b>Share</b><span>Export for the web or print, or send a picture straight to Lumora, Studio or Titler.</span></li>
          </ul>
          <div class="studio__cta">
            <a class="btn btn--blue btn--big" href="https://github.com/yehudakogan770/Livestreamingapp/releases/latest/download/Lumora-Photo-Setup.exe"
              >Download Lumora Photo</a
            >
            <p class="fine">Free · Windows 10 and 11 · or <a href="photo/">open it in your browser</a></p>
          </div>
        </div>
      </section>
"""
a = """
      <!-- Light: comments. -->"""
assert a in s
s = s.replace(a, section + a, 1)
card = """            <article class="dlcard dlcard--photo">
              <img src="img/photo-mark.svg" alt="" width="56" height="56" />
              <h3>Lumora Photo</h3>
              <p>Photo editing, retouching and design.</p>
              <a class="btn btn--blue btn--big" href="https://github.com/yehudakogan770/Livestreamingapp/releases/latest/download/Lumora-Photo-Setup.exe"
                >Download Lumora Photo</a
              >
            </article>
"""
b = """                >Download Lumora Titler</a
              >
            </article>
"""
assert s.count(b) == 1
s = s.replace(b, b + card, 1)
s = s.replace("<p>All three apps are free. No subscription, no watermark.</p>", "<p>All four apps are free. No subscription, no watermark.</p>")
open(p, 'w').write(s)

p = root + '/docs/site.css'
s = open(p).read()
s = s.replace(""".dlcard--titler {
  border-top-color: var(--violet);
}""", """.dlcard--titler {
  border-top-color: var(--violet);
}
.dlcard--photo {
  border-top-color: var(--blue);
}""")
s = s.replace(""".dlcards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));""", """.dlcards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));""")
s = s.replace(""".titler .studio__cta .fine a {
  color: #fff;
}""", """.titler .studio__cta .fine a {
  color: #fff;
}

/* Lumora Photo: its own blue (from its mark), used as sparingly as the others. */
:root {
  --blue: #3b72d9;
  --blue-2: #7ea6ee;
}
.btn--blue {
  background: var(--blue);
  color: #fff;
}
.btn--blue:hover {
  background: #4a80e4;
}
.photo {
  background: var(--ink);
}
.photo__verbs span:nth-child(3) {
  color: var(--blue-2);
}
.pages--photo li:first-child {
  border-top-color: var(--blue);
}
.photo .studio__cta .fine a {
  color: #fff;
}""")
open(p, 'w').write(s)
print('ok')
