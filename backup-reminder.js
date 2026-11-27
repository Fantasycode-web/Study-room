/* The Study Room: backup reminder
   Shows a small banner under the header when there's study data
   and no backup in the last 7 days. "Remind me later" hides it for 3 days. */
(() => {
  'use strict';

  const META_KEY = 'studyroom.backup.meta';
  const DAY = 86400000;
  const STALE_DAYS = 7;
  const SNOOZE_DAYS = 3;

  let meta = {};
  let hasData = false;
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {};
    const fc = JSON.parse(localStorage.getItem('studyroom.flashcards.v1') || 'null');
    const qz = JSON.parse(localStorage.getItem('studyroom.quizzes.v1') || 'null');
    // Only nag once you've built something of your own, not for the sample content alone.
    const decks = fc && Array.isArray(fc.decks) ? fc.decks : [];
    const quizzes = qz && Array.isArray(qz.quizzes) ? qz.quizzes : [];
    const sm = JSON.parse(localStorage.getItem('studyroom.summaries.v1') || 'null');
    const summaries = sm && Array.isArray(sm.summaries) ? sm.summaries : [];
    const isSample = (name) => String(name || '').startsWith('Sample:');
    hasData = decks.some((d) => !isSample(d.name) && (d.cards || []).length > 0) ||
              quizzes.some((q) => !isSample(q.title) && (q.questions || []).length > 0) ||
              summaries.some((s) => !isSample(s.title) && String(s.body || '').trim().length > 0);
  } catch (e) { return; }

  const now = Date.now();
  const last = meta.lastExport ? new Date(meta.lastExport).getTime() : 0;
  if (!hasData || now - last < STALE_DAYS * DAY || (meta.snoozeUntil && now < meta.snoozeUntil)) return;

  const banner = document.createElement('div');
  banner.className = 'backup-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Backup reminder');
  banner.innerHTML = `
    <div class="container backup-banner-inner">
      <p>${last ? "It's been over a week since your last backup." : "You haven't backed up your study data yet."}
        It only lives in this browser.</p>
      <div class="backup-banner-actions">
        <a href="backup.html" class="btn btn-primary btn-small">Back up now</a>
        <button type="button" class="btn btn-text btn-small">Remind me later</button>
      </div>
    </div>`;

  banner.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(META_KEY, JSON.stringify({ ...meta, snoozeUntil: Date.now() + SNOOZE_DAYS * DAY })); } catch (e) { /* unavailable */ }
    banner.remove();
  });

  const header = document.querySelector('.site-header');
  (header || document.body.firstElementChild).after(banner);
})();
