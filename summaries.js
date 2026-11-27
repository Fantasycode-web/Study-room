/* The Study Room: Summaries
   Summaries are written in a small, safe subset of Markdown and saved in localStorage.
   Views are driven by the URL hash: #read/<id>, #edit/<id>, #new, or none (library). */
(() => {
  'use strict';

  const KEY = 'studyroom.summaries.v1';
  const FLASHCARD_KEY = 'studyroom.flashcards.v1';
  const QUIZ_KEY = 'studyroom.quizzes.v1';
  const WORDS_PER_MINUTE = 200;

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) node.append(c); });
    return node;
  }

  function relDay(iso) {
    const days = Math.floor((startOfDay(Date.now()) - startOfDay(new Date(iso).getTime())) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

  /* ================= Markdown (safe subset) ================= */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Plain text version of inline Markdown (for TOC, excerpts, flashcards).
  function plain(s) {
    return String(s)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|==|`)/g, '')
      .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
      .trim();
  }

  function inline(text) {
    let s = escapeHtml(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, rawUrl) => {
      const url = rawUrl.replace(/&amp;/g, '&');
      // Allow web links, email, in-page anchors and relative links only (never javascript: etc.)
      if (!/^(https?:\/\/|mailto:|#|[\w./-]+$)/i.test(url)) return label;
      const external = /^https?:/i.test(url);
      return `<a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    });
    s = s.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/==(\S(?:.*?\S)?)==/g, '<mark>$1</mark>');
    s = s.replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
    return s;
  }

  const BLOCK_START = /^(#{1,4}\s|>|```|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/;

  function renderMarkdown(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const toc = [];
    const used = new Map();
    const slug = (t) => {
      const base = plain(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
      const n = used.get(base) || 0;
      used.set(base, n + 1);
      return `s-${n ? `${base}-${n}` : base}`;
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
        continue;
      }

      let m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        const level = m[1].length <= 2 ? 2 : m[1].length; // # and ## are both sections (the title is the h1)
        const text = m[2].replace(/\s+#+\s*$/, '').trim();
        const id = slug(text);
        out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
        if (level <= 3) toc.push({ level, id, text: plain(text) });
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      if (/^>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${renderMarkdown(buf.join('\n')).html}</blockquote>`);
        continue;
      }

      const listType = /^\s*[-*+]\s+/.test(line) ? 'ul' : /^\s*\d+[.)]\s+/.test(line) ? 'ol' : null;
      if (listType) {
        const marker = listType === 'ul' ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/;
        const items = [];
        while (i < lines.length && lines[i].trim()) {
          if (marker.test(lines[i])) items.push(lines[i].replace(marker, ''));
          else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`; // wrapped item
          else break;
          i++;
        }
        const start = listType === 'ol' ? Number((line.match(/\d+/) || ['1'])[0]) : 1;
        out.push(`<${listType}${start > 1 ? ` start="${start}"` : ''}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${listType}>`);
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !BLOCK_START.test(lines[i]))) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
    return { html: out.join('\n'), toc };
  }

  // Lines like "**Term**: definition" or "- **Term** — definition" become flashcards.
  function extractTerms(md) {
    const terms = [];
    const seen = new Set();
    String(md).split('\n').forEach((raw) => {
      const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      const m = line.match(/^\*\*(.+?)\*\*\s*(?::|[-–—]\s)\s*(.+)$/) || line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (!m) return;
      const front = plain(m[1]).replace(/:$/, '').trim();
      const back = plain(m[2]).trim();
      if (!front || !back || seen.has(normalize(front))) return;
      seen.add(normalize(front));
      terms.push({ front, back });
    });
    return terms;
  }

  /* ================= Data ================= */
  const TEMPLATE = `## Big picture

What is this chapter about, in two or three sentences?

## Key terms

- **Term**: what it means, in your own words
- **Another term**: definition

## Main ideas

1. First big idea
2. Second big idea

## Takeaways

> The one thing to remember from this chapter.
`;

  const SAMPLE_BODY = `## Big picture

Most students study by **re-reading** and **highlighting**. They feel productive, but research shows they're among the *least* effective methods. The techniques that work best feel harder in the moment, and that effort is exactly what builds lasting memory.

## Key terms

- **Active recall**: Testing yourself by pulling information out of memory instead of re-reading it.
- **Spaced repetition**: Reviewing material at increasing intervals over time so it moves into long-term memory.
- **Interleaving**: Mixing different topics or problem types in one session instead of studying one at a time.
- **Elaboration**: Explaining new ideas in your own words and connecting them to what you already know.
- **Dual coding**: Pairing words with visuals so you have two ways to remember the same idea.

## Why it works

### The forgetting curve

In the 1880s, Hermann Ebbinghaus showed that we forget most new information within days, ==unless we review it==. Each review flattens the curve, so the next review can come later.

### Desirable difficulty

When remembering takes effort, the memory gets stronger. That's why a quiz feels harder than re-reading, and why it works better.

## How to use this site

1. **Read** the summary to get the big picture.
2. **Drill** the key terms with flashcards.
3. **Check** yourself with a short quiz.
4. **Prove it** with a timed practice test a few days later.

## Takeaways

> If studying feels easy, you're probably not learning much. Test yourself early, often, and spaced out over time.
`;

  function load() {
    const data = readJSON(KEY);
    if (data && Array.isArray(data.summaries)) return data;
    const now = new Date().toISOString();
    return { summaries: [{ id: uid(), title: 'Sample: The science of studying', subject: 'Study skills', body: SAMPLE_BODY,
      deckId: null, quizId: null, createdAt: now, updatedAt: now, reviewedAt: null }] };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  const state = load();
  const find = (id) => state.summaries.find((s) => s.id === id);

  const decks = () => ((readJSON(FLASHCARD_KEY) || {}).decks || []);
  const quizzes = () => ((readJSON(QUIZ_KEY) || {}).quizzes || []);

  function wordCount(md) { return (plain(md).match(/[\p{L}\p{N}']+/gu) || []).length; }
  function readMinutes(md) { return Math.max(1, Math.round(wordCount(md) / WORDS_PER_MINUTE)); }

  function excerpt(md) {
    const para = String(md).split('\n').map((l) => l.trim())
      .filter((l) => l && !BLOCK_START.test(l))
      .slice(0, 3).join(' ');
    const text = plain(para);
    return text.length > 180 ? `${text.slice(0, 177).replace(/\s+\S*$/, '')}…` : text;
  }

  /* ================= Views & routing ================= */
  const views = { library: $('view-library'), read: $('view-read'), edit: $('view-edit') };
  let currentView = null;

  function showView(name) {
    currentView = name;
    Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
    document.body.classList.toggle('editing', name === 'edit');
    $('read-progress').hidden = name !== 'read';
    window.scrollTo({ top: 0 });
  }

  function route() {
    flushSave();
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash === 'new') {
      const now = new Date().toISOString();
      const s = { id: uid(), title: '', subject: '', body: TEMPLATE, deckId: null, quizId: null, createdAt: now, updatedAt: now, reviewedAt: null };
      state.summaries.push(s);
      save();
      location.replace(`#edit/${s.id}`);
      return;
    }
    const m = hash.match(/^(read|edit)\/(.+)$/);
    if (m && find(m[2])) {
      if (m[1] === 'read') openRead(m[2]); else openEdit(m[2]);
      return;
    }
    openLibrary();
  }

  window.addEventListener('hashchange', route);

  $('to-top').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* ================= Library ================= */
  const lib = { search: $('search-input'), subject: $('subject-filter'), grid: $('summary-grid'), empty: $('library-empty') };

  function subjects() {
    return [...new Set(state.summaries.map((s) => s.subject.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function openLibrary() {
    const subs = subjects();
    const current = lib.subject.value;
    lib.subject.replaceChildren(h('option', { value: '', text: 'All subjects' }), ...subs.map((s) => h('option', { value: s, text: s })));
    lib.subject.value = subs.includes(current) ? current : '';
    lib.subject.parentElement.hidden = subs.length === 0;
    renderLibrary();
    if (currentView !== 'library') showView('library');
    document.title = 'Summaries · The Study Room';
  }

  function renderLibrary() {
    const q = normalize(lib.search.value);
    const subject = lib.subject.value;
    const list = state.summaries
      .filter((s) => !subject || s.subject.trim() === subject)
      .filter((s) => !q || normalize(`${s.title} ${s.subject} ${plain(s.body)}`).includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    lib.grid.replaceChildren(...list.map((s) => {
      const reviewed = s.reviewedAt ? h('span', { class: 'chip good', text: `Reviewed ${relDay(s.reviewedAt)}` }) : h('span', { class: 'chip stale', text: 'Not reviewed yet' });
      return h('a', { class: 'summary-card', href: `#read/${s.id}` },
        s.subject ? h('span', { class: 'eyebrow', text: s.subject }) : null,
        h('h2', { text: s.title || 'Untitled summary' }),
        h('p', { class: 'excerpt', text: excerpt(s.body) || 'No notes yet.' }),
        h('div', { class: 'card-foot' }, h('span', { text: `${readMinutes(s.body)} min read · Updated ${relDay(s.updatedAt)}` }), reviewed),
      );
    }));

    lib.empty.hidden = list.length > 0;
    lib.empty.textContent = state.summaries.length
      ? 'No summaries match your search.'
      : 'No summaries yet. Click "+ New summary" to write your first one.';
  }

  lib.search.addEventListener('input', renderLibrary);
  lib.subject.addEventListener('change', renderLibrary);

  /* ================= Reader ================= */
  const rd = {
    subject: $('read-subject'), title: $('read-title'), meta: $('read-meta'), body: $('read-body'),
    toc: $('toc'), tocList: $('toc-list'), edit: $('edit-link'), reviewed: $('reviewed-btn'), print: $('print-btn'),
    next: $('next-grid'), cardsResult: $('cards-result'), progress: $('read-progress-bar'),
  };
  let readingId = null;
  let tocObserver = null;

  function openRead(id) {
    const s = find(id);
    readingId = id;
    const { html, toc } = renderMarkdown(s.body);

    document.title = `${s.title || 'Untitled summary'} · Summaries`;
    rd.subject.textContent = s.subject;
    rd.title.textContent = s.title || 'Untitled summary';
    rd.body.innerHTML = html || '<p class="empty-note">This summary is empty. Click Edit to start writing.</p>';
    rd.edit.href = `#edit/${id}`;
    rd.cardsResult.textContent = '';
    renderMeta(s);

    rd.tocList.replaceChildren(...toc.map((t) => h('li', { class: t.level === 3 ? 'sub' : null },
      h('a', { href: `#${t.id}`, 'data-target': t.id, text: t.text, onclick: (e) => {
        e.preventDefault(); // keep the #read/<id> route in the URL
        const target = document.getElementById(t.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }))));
    rd.toc.hidden = toc.length < 2;
    watchToc();
    renderNextSteps(s);
    showView('read');
    updateProgress();
  }

  function renderMeta(s) {
    const parts = [`${readMinutes(s.body)} min read`, `Updated ${relDay(s.updatedAt)}`];
    if (s.reviewedAt) parts.push(`Reviewed ${relDay(s.reviewedAt)}`);
    rd.meta.textContent = parts.join(' · ');
    const today = s.reviewedAt && relDay(s.reviewedAt) === 'today';
    rd.reviewed.textContent = today ? '✓ Reviewed today' : '✓ Mark as reviewed';
    rd.reviewed.classList.toggle('is-done', !!today);
  }

  rd.reviewed.addEventListener('click', () => {
    const s = find(readingId);
    s.reviewedAt = new Date().toISOString();
    save();
    renderMeta(s);
  });

  rd.print.addEventListener('click', () => window.print());

  function watchToc() {
    if (tocObserver) tocObserver.disconnect();
    const links = [...rd.tocList.querySelectorAll('a')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const byId = new Map(links.map((a) => [a.dataset.target, a]));
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove('active'));
        const link = byId.get(entry.target.id);
        if (link) link.classList.add('active');
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    rd.body.querySelectorAll('h2[id], h3[id]').forEach((el) => tocObserver.observe(el));
  }

  function updateProgress() {
    if (currentView !== 'read') return;
    const article = rd.body.getBoundingClientRect();
    const total = article.height - window.innerHeight * 0.6;
    const done = Math.min(1, Math.max(0, (-article.top + 120) / Math.max(total, 1)));
    rd.progress.style.width = `${Math.round(done * 100)}%`;
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);

  function openDeck(deckId) {
    const data = readJSON(FLASHCARD_KEY);
    if (data && data.decks.some((d) => d.id === deckId)) {
      data.currentDeckId = deckId; // so the Flashcards page opens on this deck
      try { localStorage.setItem(FLASHCARD_KEY, JSON.stringify(data)); } catch (e) { /* unavailable */ }
    }
    location.href = 'flashcards.html';
  }

  function nextCard({ icon, title, text, onclick, href, disabled }) {
    const kids = [h('span', { class: 'next-icon', 'aria-hidden': 'true', text: icon }), h('strong', { text: title }), h('span', { text })];
    return href ? h('a', { class: 'next-card', href }, kids) : h('button', { type: 'button', class: 'next-card', onclick, disabled }, kids);
  }

  function renderNextSteps(s) {
    const deck = s.deckId && decks().find((d) => d.id === s.deckId);
    const quiz = s.quizId && quizzes().find((q) => q.id === s.quizId);
    const terms = extractTerms(s.body);
    const cards = [];

    if (deck) {
      cards.push(nextCard({ icon: '🗂️', title: 'Drill the flashcards', text: `${deck.name} · ${plural(deck.cards.length, 'card')}`, onclick: () => openDeck(deck.id) }));
    }
    if (terms.length) {
      const existing = new Set(deck ? deck.cards.map((c) => normalize(c.front)) : []);
      const fresh = terms.filter((t) => !existing.has(normalize(t.front)));
      cards.push(fresh.length
        ? nextCard({ icon: '✨', title: `Make ${plural(fresh.length, 'flashcard')}`, text: deck ? `From the key terms, added to ${deck.name}` : 'From the key terms in this summary', onclick: () => makeFlashcards(s) })
        : nextCard({ icon: '✨', title: 'Key terms are in your deck', text: `All ${plural(terms.length, 'term')} already have flashcards`, disabled: true }));
    }
    if (s.body.trim()) {
      cards.push(nextCard({ icon: '🎧', title: 'Listen as a podcast', text: 'Narrated, with a recall quiz at the end', href: `podcast.html#ep/${s.id}` }));
    }
    if (quiz) {
      cards.push(nextCard({ icon: '✅', title: 'Take the quiz', text: `${quiz.title} · ${plural(quiz.questions.length, 'question')}`, href: `quizzes.html#start/${quiz.id}` }));
    }
    if (!deck && !quiz && !terms.length) {
      cards.push(nextCard({ icon: '🔗', title: 'Link a deck or quiz', text: 'Connect this summary to flashcards or a quiz on the same topic', href: `#edit/${s.id}` }));
    }
    rd.next.replaceChildren(...cards);
  }

  function makeFlashcards(s) {
    const terms = extractTerms(s.body);
    let data = readJSON(FLASHCARD_KEY);
    if (!data || !Array.isArray(data.decks)) data = { decks: [], currentDeckId: null };

    let deck = s.deckId && data.decks.find((d) => d.id === s.deckId);
    if (!deck) {
      deck = { id: uid(), name: s.title || 'Untitled summary', cards: [] };
      data.decks.push(deck);
      s.deckId = deck.id;
      save();
    }
    const existing = new Set(deck.cards.map((c) => normalize(c.front)));
    const fresh = terms.filter((t) => !existing.has(normalize(t.front)));
    fresh.forEach((t) => deck.cards.push({ id: uid(), front: t.front, back: t.back, known: false }));
    data.currentDeckId = deck.id;

    try { localStorage.setItem(FLASHCARD_KEY, JSON.stringify(data)); }
    catch (e) { rd.cardsResult.textContent = 'Your browser wouldn\'t save the flashcards (storage may be full).'; return; }

    renderNextSteps(s);
    rd.cardsResult.replaceChildren(`Added ${plural(fresh.length, 'flashcard')} to "${deck.name}". `, h('a', { href: 'flashcards.html', text: 'Study them now →' }));
  }

  /* ================= Editor ================= */
  const ed = {
    title: $('title-input'), subject: $('subject-input'), subjectList: $('subject-list'),
    deck: $('deck-select'), quiz: $('quiz-select'), body: $('body-input'), preview: $('preview'),
    status: $('save-status'), done: $('done-link'), back: $('edit-back'), del: $('delete-btn'),
    panes: $('editor-panes'), tabWrite: $('tab-write'), tabPreview: $('tab-preview'),
  };
  let editingId = null;
  let saveTimer = null;
  let previewTimer = null;

  function options(select, items, emptyLabel, selected) {
    const exists = items.some((i) => i.id === selected);
    select.replaceChildren(h('option', { value: '', text: emptyLabel }), ...items.map((i) => h('option', { value: i.id, text: i.label })));
    select.value = exists ? selected : '';
  }

  function openEdit(id) {
    const s = find(id);
    editingId = id;
    ed.title.value = s.title;
    ed.subject.value = s.subject;
    ed.subjectList.replaceChildren(...subjects().map((v) => h('option', { value: v })));
    options(ed.deck, decks().map((d) => ({ id: d.id, label: `${d.name} (${plural(d.cards.length, 'card')})` })), 'None', s.deckId);
    options(ed.quiz, quizzes().map((q) => ({ id: q.id, label: `${q.title} (${plural(q.questions.length, 'question')})` })), 'None', s.quizId);
    ed.body.value = s.body;
    ed.done.href = `#read/${id}`;
    ed.back.href = '#';
    ed.status.textContent = '';
    setTab('write');
    renderPreview();
    showView('edit');
    document.title = `Editing: ${s.title || 'Untitled summary'} · Summaries`;
    if (!s.title) ed.title.focus();
  }

  function renderPreview() {
    ed.preview.innerHTML = renderMarkdown(ed.body.value).html || '<p class="empty-note">Nothing to preview yet.</p>';
  }

  function scheduleSave() {
    ed.status.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }

  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const s = find(editingId);
    if (!s) return;
    s.title = ed.title.value.trim();
    s.subject = ed.subject.value.trim();
    s.deckId = ed.deck.value || null;
    s.quizId = ed.quiz.value || null;
    s.body = ed.body.value;
    s.updatedAt = new Date().toISOString();
    ed.status.textContent = save() ? 'All changes saved' : 'Couldn\'t save. Storage may be full.';
  }

  [ed.title, ed.subject, ed.body].forEach((input) => input.addEventListener('input', scheduleSave));
  [ed.deck, ed.quiz].forEach((sel) => sel.addEventListener('change', scheduleSave));
  ed.body.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 150); });
  window.addEventListener('beforeunload', flushSave);

  ed.del.addEventListener('click', () => {
    const s = find(editingId);
    if (!confirm(`Delete "${s.title || 'Untitled summary'}"? This can't be undone.`)) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    state.summaries = state.summaries.filter((x) => x.id !== editingId);
    save();
    editingId = null;
    location.hash = '';
  });

  function setTab(view) {
    ed.panes.dataset.view = view;
    ed.tabWrite.setAttribute('aria-selected', String(view === 'write'));
    ed.tabPreview.setAttribute('aria-selected', String(view === 'preview'));
    if (view === 'preview') renderPreview();
  }
  ed.tabWrite.addEventListener('click', () => setTab('write'));
  ed.tabPreview.addEventListener('click', () => setTab('preview'));

  // --- Formatting toolbar ---
  function replaceRange(start, end, text, selStart, selEnd) {
    const ta = ed.body;
    ta.focus();
    ta.setSelectionRange(start, end);
    // execCommand keeps the browser's undo history; fall back if unsupported.
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  function wrap(before, after = before, placeholder = 'text') {
    const ta = ed.body;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    replaceRange(s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  }

  function prefixLines(kind) {
    const ta = ed.body;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const ls = value.lastIndexOf('\n', s - 1) + 1;
    let le = value.indexOf('\n', e === s ? e : e - 1);
    if (le === -1) le = value.length;
    const lines = value.slice(ls, le).split('\n');
    const patterns = { h2: /^#{1,4}\s+/, h3: /^#{1,4}\s+/, ul: /^\s*[-*+]\s+/, ol: /^\s*\d+[.)]\s+/, quote: /^>\s?/ };
    const prefix = (i) => ({ h2: '## ', h3: '### ', ul: '- ', ol: `${i + 1}. `, quote: '> ' }[kind]);
    const already = lines.every((l) => (kind === 'h2' ? /^##\s/.test(l) : kind === 'h3' ? /^###\s/.test(l) : patterns[kind].test(l)));
    const next = lines.map((l, i) => {
      const stripped = l.replace(patterns[kind], '');
      return already ? stripped : prefix(i) + stripped;
    }).join('\n');
    replaceRange(ls, le, next, ls, ls + next.length);
  }

  function insertTerm() {
    const ta = ed.body;
    const { selectionStart: s, value } = ta;
    const atLineStart = s === 0 || value[s - 1] === '\n';
    const lead = atLineStart ? '' : '\n';
    const text = `${lead}- **Term**: definition`;
    const termStart = s + lead.length + 4;
    replaceRange(s, ta.selectionEnd, text, termStart, termStart + 4);
  }

  document.querySelector('.toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'bold') wrap('**');
    else if (cmd === 'italic') wrap('*');
    else if (cmd === 'mark') wrap('==');
    else if (cmd === 'term') insertTerm();
    else prefixLines(cmd);
  });

  ed.body.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrap('**'); }
    else if (k === 'i') { e.preventDefault(); wrap('*'); }
  });

  // Links like [see above](#key-terms) inside a summary scroll instead of changing the route.
  [rd.body, ed.preview].forEach((container) => container.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const raw = decodeURIComponent(a.getAttribute('href').slice(1));
    const target = document.getElementById(raw) || document.getElementById(`s-${raw}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  /* ================= Start ================= */
  save(); // persist the sample so backups and other pages can see it
  route();
})();
