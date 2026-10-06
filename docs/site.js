// Lumora website: the phone menu, the feedback form and the year. Nothing else.
(() => {
  // Menu on narrow screens.
  const menu = document.querySelector('[data-menu]');
  const nav = document.getElementById('nav');
  const setOpen = (open) => {
    nav?.classList.toggle('is-open', open);
    menu?.setAttribute('aria-expanded', String(open));
  };
  menu?.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
  nav?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      menu.focus();
    }
  });

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
