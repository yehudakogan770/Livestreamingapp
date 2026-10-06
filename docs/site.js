// Lumora website: the "on air" light on the entry being read, the feedback form and the year.
(() => {
  // The time of the entry in the middle of the screen turns red, like a tally light.
  const entries = [...document.querySelectorAll('.entry')];
  if ('IntersectionObserver' in window && entries.length) {
    const io = new IntersectionObserver(
      (seen) => {
        for (const e of seen) e.target.classList.toggle('is-on', e.isIntersecting);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    entries.forEach((e) => io.observe(e));
  }

  // Feedback: sent through Web3Forms, so nobody has to sign in to anything.
  // Put the access key from web3forms.com here (it only lets people send to you).
  const FEEDBACK_KEY = '62155090-df58-430c-9c77-2724a61adb72';
  const form = document.querySelector('[data-feedback]');
  const status = document.querySelector('[data-status]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const say = (text, cls) => {
      status.textContent = text;
      status.className = `form__status ${cls || ''}`;
    };
    if (FEEDBACK_KEY.startsWith('PASTE')) return say('Feedback is not switched on yet. Please try again soon.', 'is-bad');
    const data = Object.fromEntries(new FormData(form));
    if (data.botcheck) return;
    btn.disabled = true;
    say('Sending…');
    try {
      const r = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: FEEDBACK_KEY,
          subject: `Lumora feedback: ${data.topic}`,
          from_name: data.name || 'Lumora website',
          name: data.name,
          email: data.email,
          topic: data.topic,
          message: data.message,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.message || 'not sent');
      form.reset();
      say('Thank you. Your message was sent.', 'is-ok');
    } catch {
      say('That did not go through. Please check your internet connection and try again.', 'is-bad');
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = String(new Date().getFullYear())));
})();
