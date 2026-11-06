(function () {
  var html = document.documentElement;
  var q = new URLSearchParams(location.search);
  var NL = String.fromCharCode(10);
  var MAILS = {
    en: {
      s: 'Request for quote - SwissTech Precision Solutions',
      b: ['Hello,', '', 'Please find my drawing / specification attached.', '', 'Company:', 'Contact person:', 'Phone:', 'Quantity / requirements:', ''].join(NL)
    },
    de: {
      s: 'Offertanfrage - SwissTech Precision Solutions',
      b: ['Guten Tag', '', 'anbei sende ich Ihnen meine Zeichnung / Spezifikation.', '', 'Firma:', 'Ansprechperson:', 'Telefon:', 'Stückzahl / Anforderungen:', ''].join(NL)
    }
  };

  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function setLang(l) {
    if (l !== 'de' && l !== 'en') { l = 'de'; }
    html.lang = l;
    try { sessionStorage.setItem('lang', l); } catch (e) { /* storage unavailable: language simply is not remembered */ }
    var m = MAILS[l];
    all('a[data-mail]').forEach(function (a) {
      a.href = 'mailto:pascal@stps.ch?cc=marco@stps.ch&subject=' + encodeURIComponent(m.s) + '&body=' + encodeURIComponent(m.b);
    });
    all('[data-alt-en]').forEach(function (el) { el.setAttribute('alt', el.getAttribute('data-alt-' + l)); });
    all('[data-aria-en]').forEach(function (el) { el.setAttribute('aria-label', el.getAttribute('data-aria-' + l)); });
    all('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-l') === l ? 'true' : 'false'); });
    var t = html.getAttribute('data-title-' + l);
    if (t) { document.title = t; }
  }

  var saved = null;
  try { saved = sessionStorage.getItem('lang'); } catch (e) { saved = null; }
  setLang(q.get('lang') || saved || 'de');

  all('.lang button').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-l')); });
  });

  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  if (nav) {
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (y > 90) { nav.classList.add('scrolled'); } else if (y < 10) { nav.classList.remove('scrolled'); }
    }, { passive: true });
    all('.menu a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        if (burger) { burger.setAttribute('aria-expanded', 'false'); }
      });
    });
  }
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
  }

  var items = all('.rv');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { all('.hero-video video').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); }); }
  if (!items.length) { return; }
  if (q.has('static')) { document.body.classList.add('noanim'); }
  if (q.has('static') || reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  items.forEach(function (el) { io.observe(el); });
})();
