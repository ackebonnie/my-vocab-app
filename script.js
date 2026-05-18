/**
 * VocabMaster – Spaced Repetition Vocabulary App
 * Algorithm: Simplified SM-2 (SuperMemo 2)
 * Storage: localStorage only
 */

'use strict';

// ============================================================
//  CONSTANTS
// ============================================================
const STORAGE_KEY = 'vocabmaster_progress';
const VOCAB_URL   = './vocab.json';

const INTERVALS = {
  FAIL:      1 * 60 * 1000,             // 1 minute
  HARD:      10 * 60 * 1000,            // 10 minutes
  EASY_BASE: 24 * 60 * 60 * 1000,       // 1 day
};

// ============================================================
//  APP STATE  (single source of truth)
// ============================================================
const state = {
  allVocab:     [],
  sessionQueue: [],
  currentIndex: 0,
  isFlipped:    false,
  sessionDone:  0,
};

// ============================================================
//  DOM HELPERS – always queried live so re-renders are safe
// ============================================================
const $ = (id) => document.getElementById(id);

// Static elements (never replaced)
const progressBar   = $('progress-bar');
const progressCount = $('progress-count');
const cardScene     = $('card-scene');
const statsBtn      = $('stats-btn');
const modalOverlay  = $('modal-overlay');
const modalClose    = $('modal-close');
const statsGrid     = $('stats-grid');
const wordListEl    = $('word-list');
const toastEl       = $('toast');

// Dynamic card elements – queried fresh each time via helpers
function getCard()        { return $('flashcard'); }
function getActionBtns()  { return $('action-buttons'); }
function getWordFront()   { return $('word-front'); }
function getTranslation() { return $('word-translation'); }
function getExample()     { return $('word-example'); }

// ============================================================
//  LOCAL STORAGE
// ============================================================
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch { showToast('⚠️ Speichern fehlgeschlagen'); }
}

// ============================================================
//  SM-2 ALGORITHM
// ============================================================
function scheduleCard(card, rating) {
  const now      = Date.now();
  const progress = loadProgress();
  const id       = card.id;

  if (!progress[id]) {
    progress[id] = { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: now, status: 'new' };
  }

  const p = progress[id];

  if (rating === 'fail') {
    p.repetitions = 0;
    p.interval    = INTERVALS.FAIL;
    p.easeFactor  = Math.max(1.3, p.easeFactor - 0.2);
    p.status      = 'learning';
  } else if (rating === 'hard') {
    p.repetitions = Math.max(0, p.repetitions - 1);
    p.interval    = p.repetitions === 0
      ? INTERVALS.HARD
      : Math.max(INTERVALS.HARD, p.interval * 1.2);
    p.easeFactor  = Math.max(1.3, p.easeFactor - 0.15);
    p.status      = 'learning';
  } else {
    p.repetitions += 1;
    if      (p.repetitions === 1) p.interval = INTERVALS.EASY_BASE;
    else if (p.repetitions === 2) p.interval = INTERVALS.EASY_BASE * 3;
    else                          p.interval = Math.round(p.interval * p.easeFactor);
    p.easeFactor = Math.min(3.5, p.easeFactor + 0.1);
    p.status     = p.repetitions >= 3 ? 'mastered' : 'learning';
  }

  p.nextReview   = now + p.interval;
  progress[id]   = p;
  saveProgress(progress);
}

// ============================================================
//  SESSION QUEUE
// ============================================================
function buildSessionQueue(vocab, progress) {
  const now = Date.now();
  const due = vocab.filter((v) => {
    const p = progress[v.id];
    return !p || p.nextReview <= now;
  });
  due.sort((a, b) => {
    const ta = progress[a.id] ? progress[a.id].nextReview : 0;
    const tb = progress[b.id] ? progress[b.id].nextReview : 0;
    return ta - tb;
  });
  return due;
}

function buildNextQueue() {
  const progress = loadProgress();
  const now = Date.now();
  return state.allVocab
    .filter((v) => { const p = progress[v.id]; return p && p.nextReview > now; })
    .sort((a, b) => progress[a.id].nextReview - progress[b.id].nextReview);
}

function formatNextInterval(queue) {
  if (!queue.length) return '–';
  const progress = loadProgress();
  const ms       = progress[queue[0].id].nextReview - Date.now();
  const min      = Math.round(ms / 60000);
  if (min < 60) return `${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} Std`;
  return `${Math.round(h / 24)} Tag${h >= 48 ? 'en' : ''}`;
}

// ============================================================
//  CARD HTML TEMPLATE
// ============================================================
const CARD_HTML = `
  <div class="card-container">
    <div class="card" id="flashcard" role="button" tabindex="0" aria-label="Karte umdrehen">
      <div class="card-face card-front">
        <span class="word-label">Englisch</span>
        <span class="word-text" id="word-front">– – –</span>
      </div>
      <div class="card-face card-back">
        <span class="translation-label">Deutsch</span>
        <span class="translation-text" id="word-translation">– – –</span>
        <div class="divider"></div>
        <span class="example-label">Beispielsatz</span>
        <p class="example-text" id="word-example">–</p>
      </div>
    </div>
  </div>
  <div class="action-buttons" id="action-buttons" aria-hidden="true">
    <button class="action-btn btn-fail" id="btn-fail" aria-label="Nicht gewusst">
      <span class="action-btn-icon">🔴</span>
      Nicht gewusst
    </button>
    <button class="action-btn btn-hard" id="btn-hard" aria-label="Schwer">
      <span class="action-btn-icon">🟡</span>
      Schwer
    </button>
    <button class="action-btn btn-easy" id="btn-easy" aria-label="Gewusst">
      <span class="action-btn-icon">🟢</span>
      Gewusst
    </button>
  </div>
`;

// ============================================================
//  RENDER CARD
// ============================================================
function renderCard(card) {
  getWordFront().textContent   = card.word;
  getTranslation().textContent = card.translation;
  getExample().textContent     = `"${card.example}"`;

  const fc = getCard();
  const ab = getActionBtns();

  state.isFlipped = false;
  fc.classList.remove('is-flipped');
  ab.classList.remove('visible');
  ab.setAttribute('aria-hidden', 'true');

  // Entry animation
  fc.classList.remove('card-enter');
  void fc.offsetWidth;
  fc.classList.add('card-enter');
}

function renderProgress() {
  const total = state.sessionQueue.length;
  const done  = state.sessionDone;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  progressBar.style.width   = pct + '%';
  progressCount.textContent = `${done} / ${total}`;
}

// ============================================================
//  FLIP CARD
// ============================================================
function flipCard() {
  state.isFlipped = !state.isFlipped;

  const fc = getCard();
  const ab = getActionBtns();

  fc.classList.toggle('is-flipped', state.isFlipped);

  if (state.isFlipped) {
    setTimeout(() => {
      ab.classList.add('visible');
      ab.removeAttribute('aria-hidden');
    }, 320);
  } else {
    ab.classList.remove('visible');
    ab.setAttribute('aria-hidden', 'true');
  }
}

// ============================================================
//  RATE CARD
// ============================================================
function rateCard(rating) {
  const card = state.sessionQueue[state.currentIndex];
  if (!card) return;

  scheduleCard(card, rating);
  state.sessionDone++;

  const messages = {
    fail: ['💪 Nicht schlimm, üb weiter!', '🔄 Kommt bald wieder!'],
    hard: ['📚 Noch ein bisschen!',         '⏱️ Bald wieder dran!'],
    easy: ['✅ Super gemacht!',              '🚀 Weiter so!',         '⭐ Klasse!'],
  };
  const list = messages[rating];
  showToast(list[Math.floor(Math.random() * list.length)]);

  state.currentIndex++;
  renderProgress();

  if (state.currentIndex >= state.sessionQueue.length) {
    setTimeout(renderDoneScreen, 500);
  } else {
    const fc = getCard();
    fc.style.opacity   = '0';
    fc.style.transform = 'scale(0.92)';
    setTimeout(() => {
      fc.style.opacity   = '';
      fc.style.transform = '';
      renderCard(state.sessionQueue[state.currentIndex]);
    }, 260);
  }
}

// ============================================================
//  DONE SCREEN
// ============================================================
function renderDoneScreen() {
  const nextQueue = buildNextQueue();
  const nextText  = nextQueue.length > 0
    ? `Nächste Karte bereit in ${formatNextInterval(nextQueue)}.`
    : 'Alle Karten gemeistert! Morgen gibt\'s neue.';

  cardScene.innerHTML = `
    <div class="done-screen" role="main">
      <div class="done-emoji">🎉</div>
      <div class="done-title">Session abgeschlossen!</div>
      <p class="done-subtitle">Du hast alle fälligen Vokabeln durchgearbeitet.<br>${nextText}</p>
      <button class="done-btn" id="restart-btn">Neue Session starten</button>
    </div>
  `;

  $('restart-btn').addEventListener('click', startSession);
}

// ============================================================
//  BIND CARD EVENTS  (called after every DOM rebuild)
// ============================================================
function bindCardEvents() {
  const fc = getCard();
  if (!fc) return;

  fc.addEventListener('click', flipCard);
  fc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  $('btn-fail').addEventListener('click', () => rateCard('fail'));
  $('btn-hard').addEventListener('click', () => rateCard('hard'));
  $('btn-easy').addEventListener('click', () => rateCard('easy'));
}

// ============================================================
//  SESSION START
// ============================================================
function startSession() {
  // Inject fresh card DOM
  cardScene.innerHTML = CARD_HTML;
  bindCardEvents();

  const progress = loadProgress();
  state.sessionQueue  = buildSessionQueue(state.allVocab, progress);
  state.currentIndex  = 0;
  state.sessionDone   = 0;
  state.isFlipped     = false;

  renderProgress();

  if (state.sessionQueue.length === 0) {
    renderDoneScreen();
    return;
  }

  renderCard(state.sessionQueue[0]);
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;

function showToast(message, duration = 2200) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ============================================================
//  STATS MODAL
// ============================================================
function openStats() {
  const progress = loadProgress();
  const now      = Date.now();

  let newCount = 0, learningCount = 0, masteredCount = 0, dueCount = 0;

  state.allVocab.forEach((v) => {
    const p = progress[v.id];
    if (!p || p.status === 'new')         newCount++;
    else if (p.status === 'mastered')     masteredCount++;
    else                                  learningCount++;
    if (!p || p.nextReview <= now)        dueCount++;
  });

  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-value">${state.allVocab.length}</div><div class="stat-label">Gesamt</div></div>
    <div class="stat-card"><div class="stat-value">${dueCount}</div><div class="stat-label">Fällig</div></div>
    <div class="stat-card"><div class="stat-value">${masteredCount}</div><div class="stat-label">Gemeistert</div></div>
    <div class="stat-card"><div class="stat-value">${learningCount}</div><div class="stat-label">In Übung</div></div>
  `;

  wordListEl.innerHTML = state.allVocab.map((v) => {
    const p = progress[v.id];
    const badgeClass = !p || p.status === 'new' ? 'badge-new'
                     : p.status === 'mastered'  ? 'badge-mastered'
                     : 'badge-learning';
    const badgeText  = !p || p.status === 'new' ? 'Neu'
                     : p.status === 'mastered'  ? 'Gemeistert'
                     : 'Lernend';
    return `
      <div class="word-list-item">
        <div>
          <div class="word-list-word">${v.word}</div>
          <div class="word-list-translation">${v.translation}</div>
        </div>
        <span class="word-list-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');

  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeStats() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ============================================================
//  STATIC EVENT LISTENERS
// ============================================================
statsBtn.addEventListener('click', openStats);
modalClose.addEventListener('click', closeStats);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeStats(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStats(); });

// ============================================================
//  BOOT
// ============================================================
async function boot() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (e) { console.warn('SW registration failed:', e); }
  }

  // Load vocab
  try {
    const resp = await fetch(VOCAB_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.allVocab = await resp.json();
  } catch (err) {
    cardScene.innerHTML = `
      <div class="done-screen">
        <div class="done-emoji">⚠️</div>
        <div class="done-title">Ladefehler</div>
        <p class="done-subtitle">vocab.json konnte nicht geladen werden. Bitte Seite neu laden.</p>
      </div>
    `;
    console.error('VocabMaster boot error:', err);
    return;
  }

  startSession();
}

boot();
