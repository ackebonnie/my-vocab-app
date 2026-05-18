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

// SM-2 intervals in milliseconds
const INTERVALS = {
  FAIL: 1 * 60 * 1000,              // 1 minute (review immediately next session)
  HARD: 10 * 60 * 1000,             // 10 minutes
  EASY_BASE: 24 * 60 * 60 * 1000,   // 1 day base for easy
};

// ============================================================
//  STATE
// ============================================================
let allVocab      = [];   // raw vocab from JSON
let sessionQueue  = [];   // cards due today
let currentIndex  = 0;    // current card index within queue
let isFlipped     = false;
let sessionDone   = 0;    // cards rated this session

// ============================================================
//  DOM REFS
// ============================================================
const flashcard     = document.getElementById('flashcard');
const wordFront     = document.getElementById('word-front');
const wordTranslation = document.getElementById('word-translation');
const wordExample   = document.getElementById('word-example');
const actionButtons = document.getElementById('action-buttons');
const btnFail       = document.getElementById('btn-fail');
const btnHard       = document.getElementById('btn-hard');
const btnEasy       = document.getElementById('btn-easy');
const progressBar   = document.getElementById('progress-bar');
const progressCount = document.getElementById('progress-count');
const cardScene     = document.getElementById('card-scene');
const statsBtn      = document.getElementById('stats-btn');
const modalOverlay  = document.getElementById('modal-overlay');
const modalClose    = document.getElementById('modal-close');
const statsGrid     = document.getElementById('stats-grid');
const wordList      = document.getElementById('word-list');
const toast         = document.getElementById('toast');

// ============================================================
//  LOCAL STORAGE HELPERS
// ============================================================

/**
 * Load progress from localStorage.
 * Returns a map: { [wordId]: CardProgress }
 * CardProgress = { interval, easeFactor, nextReview, repetitions, status }
 */
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (e) {
    showToast('⚠️ Speichern fehlgeschlagen – Speicher voll?');
  }
}

// ============================================================
//  SM-2 ALGORITHM
// ============================================================

/**
 * Update a card's scheduling based on the user's rating.
 * rating: 'fail' | 'hard' | 'easy'
 */
function scheduleCard(card, rating) {
  const now = Date.now();
  const progress = loadProgress();
  const id = card.id;

  // Initialize if new
  if (!progress[id]) {
    progress[id] = {
      interval: 0,
      easeFactor: 2.5,
      repetitions: 0,
      nextReview: now,
      status: 'new',
    };
  }

  const p = progress[id];

  if (rating === 'fail') {
    // Reset – review in 1 min (next session)
    p.repetitions = 0;
    p.interval = INTERVALS.FAIL;
    p.easeFactor = Math.max(1.3, p.easeFactor - 0.2);
    p.status = 'learning';
  } else if (rating === 'hard') {
    // Review sooner; reduce ease slightly
    p.repetitions = Math.max(0, p.repetitions - 1);
    p.interval = p.repetitions === 0
      ? INTERVALS.HARD
      : Math.max(INTERVALS.HARD, p.interval * 1.2);
    p.easeFactor = Math.max(1.3, p.easeFactor - 0.15);
    p.status = 'learning';
  } else {
    // Easy: advance repetitions, multiply interval
    p.repetitions += 1;
    if (p.repetitions === 1) {
      p.interval = INTERVALS.EASY_BASE;
    } else if (p.repetitions === 2) {
      p.interval = INTERVALS.EASY_BASE * 3;
    } else {
      p.interval = Math.round(p.interval * p.easeFactor);
    }
    p.easeFactor = Math.min(3.5, p.easeFactor + 0.1);
    p.status = p.repetitions >= 3 ? 'mastered' : 'learning';
  }

  p.nextReview = now + p.interval;
  progress[id] = p;
  saveProgress(progress);
  return p;
}

// ============================================================
//  SESSION QUEUE BUILDER
// ============================================================

function buildSessionQueue(vocab, progress) {
  const now = Date.now();

  // Cards due: nextReview <= now  OR  new (never seen)
  const due = vocab.filter((v) => {
    const p = progress[v.id];
    if (!p) return true;                  // new card
    return p.nextReview <= now;           // overdue
  });

  // Sort: overdue first, then new
  due.sort((a, b) => {
    const pa = progress[a.id];
    const pb = progress[b.id];
    const ta = pa ? pa.nextReview : 0;
    const tb = pb ? pb.nextReview : 0;
    return ta - tb;
  });

  return due;
}

// ============================================================
//  UI RENDERING
// ============================================================

function renderCard(card) {
  wordFront.textContent       = card.word;
  wordTranslation.textContent = card.translation;
  wordExample.textContent     = `"${card.example}"`;

  // Reset flip
  flashcard.classList.remove('is-flipped');
  isFlipped = false;

  // Hide action buttons
  actionButtons.classList.remove('visible');
  actionButtons.setAttribute('aria-hidden', 'true');

  // Card enter animation
  flashcard.classList.remove('card-enter');
  void flashcard.offsetWidth; // reflow
  flashcard.classList.add('card-enter');
}

function renderProgress() {
  const total   = sessionQueue.length;
  const done    = sessionDone;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  progressBar.style.width   = pct + '%';
  progressCount.textContent = `${done} / ${total}`;
}

function renderDoneScreen(hasMoreToday) {
  cardScene.innerHTML = '';

  const done = document.createElement('div');
  done.className = 'done-screen';
  done.setAttribute('role', 'main');

  const nextQueue = buildNextQueue();
  const nextText  = nextQueue.length > 0
    ? `Nächste Karte bereit in ${formatNextInterval(nextQueue)}.`
    : 'Alle Karten gemeistert! Morgen gibt\'s neue.';

  done.innerHTML = `
    <div class="done-emoji">🎉</div>
    <div class="done-title">Session abgeschlossen!</div>
    <p class="done-subtitle">Du hast alle fälligen Vokabeln durchgearbeitet.<br>${nextText}</p>
    <button class="done-btn" id="restart-btn">Neue Session starten</button>
  `;

  cardScene.appendChild(done);

  document.getElementById('restart-btn').addEventListener('click', () => {
    init();
  });
}

function buildNextQueue() {
  const progress = loadProgress();
  const now = Date.now();
  return allVocab.filter((v) => {
    const p = progress[v.id];
    return p && p.nextReview > now;
  }).sort((a, b) => progress[a.id].nextReview - progress[b.id].nextReview);
}

function formatNextInterval(queue) {
  if (!queue.length) return '–';
  const progress = loadProgress();
  const nextMs   = progress[queue[0].id].nextReview - Date.now();
  const minutes  = Math.round(nextMs / 60000);
  if (minutes < 60) return `${minutes} Min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} Std`;
  return `${Math.round(hours / 24)} Tag${hours >= 48 ? 'en' : ''}`;
}

// ============================================================
//  FLIP & BUTTONS
// ============================================================

function flipCard() {
  isFlipped = !isFlipped;
  flashcard.classList.toggle('is-flipped', isFlipped);

  if (isFlipped) {
    // Show rating buttons after a slight delay (card animation)
    setTimeout(() => {
      actionButtons.classList.add('visible');
      actionButtons.removeAttribute('aria-hidden');
    }, 320);
  } else {
    actionButtons.classList.remove('visible');
    actionButtons.setAttribute('aria-hidden', 'true');
  }
}

function rateCard(rating) {
  const card = sessionQueue[currentIndex];
  if (!card) return;

  scheduleCard(card, rating);
  sessionDone++;

  // Toast feedback
  const messages = {
    fail: ['💪 Nicht schlimm, üb weiter!', '🔄 Kommt bald wieder!'],
    hard: ['📚 Noch ein bisschen!', '⏱️ Bald wieder dran!'],
    easy: ['✅ Super gemacht!', '🚀 Weiter so!', '⭐ Klasse!'],
  };
  const list = messages[rating];
  showToast(list[Math.floor(Math.random() * list.length)]);

  // Advance
  currentIndex++;
  renderProgress();

  if (currentIndex >= sessionQueue.length) {
    // Session done
    setTimeout(renderDoneScreen, 500);
  } else {
    // Animate out old card, show next
    flashcard.style.opacity = '0';
    flashcard.style.transform = 'scale(0.92)';
    setTimeout(() => {
      flashcard.style.opacity = '';
      flashcard.style.transform = '';
      renderCard(sessionQueue[currentIndex]);
    }, 260);
  }
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;

function showToast(message, duration = 2200) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ============================================================
//  STATS MODAL
// ============================================================

function openStats() {
  const progress = loadProgress();
  const now      = Date.now();

  // Summary stats
  let newCount      = 0;
  let learningCount = 0;
  let masteredCount = 0;
  let dueCount      = 0;

  allVocab.forEach((v) => {
    const p = progress[v.id];
    if (!p || p.status === 'new') {
      newCount++;
    } else if (p.status === 'mastered') {
      masteredCount++;
    } else {
      learningCount++;
    }
    if (!p || p.nextReview <= now) dueCount++;
  });

  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${allVocab.length}</div>
      <div class="stat-label">Gesamt</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${dueCount}</div>
      <div class="stat-label">Fällig</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${masteredCount}</div>
      <div class="stat-label">Gemeistert</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${learningCount}</div>
      <div class="stat-label">In Übung</div>
    </div>
  `;

  wordList.innerHTML = allVocab.map((v) => {
    const p = progress[v.id];
    let badgeClass = 'badge-new';
    let badgeText  = 'Neu';
    if (p) {
      if (p.status === 'mastered') { badgeClass = 'badge-mastered'; badgeText = 'Gemeistert'; }
      else if (p.status === 'learning') { badgeClass = 'badge-learning'; badgeText = 'Lernend'; }
    }
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
//  EVENT LISTENERS
// ============================================================

flashcard.addEventListener('click', flipCard);
flashcard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
});

btnFail.addEventListener('click', () => rateCard('fail'));
btnHard.addEventListener('click', () => rateCard('hard'));
btnEasy.addEventListener('click', () => rateCard('easy'));

statsBtn.addEventListener('click', openStats);
modalClose.addEventListener('click', closeStats);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeStats();
});

// Keyboard ESC to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeStats();
});

// ============================================================
//  INIT
// ============================================================

async function init() {
  // Rebuild queue without replacing cardScene DOM until needed
  if (cardScene.querySelector('.done-screen')) {
    cardScene.innerHTML = `
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
    // Re-bind fresh DOM refs
    rebindDomRefs();
  }

  const progress = loadProgress();
  sessionQueue   = buildSessionQueue(allVocab, progress);
  currentIndex   = 0;
  sessionDone    = 0;

  renderProgress();

  if (sessionQueue.length === 0) {
    renderDoneScreen(false);
    return;
  }

  renderCard(sessionQueue[0]);
}

function rebindDomRefs() {
  // After DOM replacement, re-query elements and rebind events
  const fc = document.getElementById('flashcard');
  const ab = document.getElementById('action-buttons');

  fc.addEventListener('click', flipCard);
  fc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  document.getElementById('btn-fail').addEventListener('click', () => rateCard('fail'));
  document.getElementById('btn-hard').addEventListener('click', () => rateCard('hard'));
  document.getElementById('btn-easy').addEventListener('click', () => rateCard('easy'));

  // Update module-level refs
  Object.assign(window, {
    flashcard: fc,
    actionButtons: ab,
    wordFront: document.getElementById('word-front'),
    wordTranslation: document.getElementById('word-translation'),
    wordExample: document.getElementById('word-example'),
  });

  // Patch local vars via closure workaround
  flashcard.id      && patchRefs(fc, ab);
}

function patchRefs(fc, ab) {
  // Reassign the closure variables (JS closures captured at declaration time,
  // so we use a trick: shadow with window globals for re-rendered elements)
  window._flashcard     = fc;
  window._actionButtons = ab;
}

// Override render functions to use window refs when available
function getFlashcard() { return window._flashcard || flashcard; }
function getActionButtons() { return window._actionButtons || actionButtons; }

// Patch renderCard & flipCard to use dynamic refs
const _renderCard = renderCard;
renderCard = function(card) {
  const fc = getFlashcard();
  const ab = getActionButtons();

  document.getElementById('word-front').textContent       = card.word;
  document.getElementById('word-translation').textContent = card.translation;
  document.getElementById('word-example').textContent     = `"${card.example}"`;

  fc.classList.remove('is-flipped');
  isFlipped = false;

  ab.classList.remove('visible');
  ab.setAttribute('aria-hidden', 'true');

  fc.classList.remove('card-enter');
  void fc.offsetWidth;
  fc.classList.add('card-enter');
};

const _flipCard = flipCard;
flipCard = function() {
  const fc = getFlashcard();
  const ab = getActionButtons();

  isFlipped = !isFlipped;
  fc.classList.toggle('is-flipped', isFlipped);

  if (isFlipped) {
    setTimeout(() => {
      ab.classList.add('visible');
      ab.removeAttribute('aria-hidden');
    }, 320);
  } else {
    ab.classList.remove('visible');
    ab.setAttribute('aria-hidden', 'true');
  }
};

// ============================================================
//  BOOT
// ============================================================

async function boot() {
  try {
    const resp = await fetch(VOCAB_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allVocab = await resp.json();
  } catch (err) {
    // Fallback: show error in card
    wordFront.textContent = '⚠️ Fehler beim Laden';
    wordExample.textContent = 'Bitte sicherstellen, dass vocab.json vorhanden ist.';
    console.error('VocabMaster: Failed to load vocab.json', err);
    return;
  }

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('SW registration failed:', e);
    }
  }

  await init();
}

boot();
