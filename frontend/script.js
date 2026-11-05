/**
 * WANDA — Client Application Logic (Vanilla JS PWA)
 * - Navigation fluide
 * - Compteur optimiste en temps réel
 * - Synthèse sonore Web Audio API (0 ko data)
 * - Partage WhatsApp personnalisé
 */

function setElementHidden(element, hidden) {
  if (element) element.classList.toggle('is-hidden', hidden);
}

function setElementVisible(element, visible) {
  if (element) element.classList.toggle('is-visible', visible);
}

// ==========================================
// CONFIGURATION & ÉTAT LOCAL
// ==========================================
const API_URL = '/api';

// Identifiant unique anonyme stocké sur l'appareil
let clientToken = localStorage.getItem('wanda_client_token');
if (!clientToken) {
  clientToken = 'user_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  localStorage.setItem('wanda_client_token', clientToken);
}

  // État de l'application
const state = {
  activeTab: 'counter', // 'counter' | 'wall'
  counterValue: 0,
  selectedCategory: 'Tous',
  sortMode: 'hot',           // 'hot' | 'recent' | 'top'
  seenPostIds: new Set(      // Déduplication : posts déjà vus (persisté en localStorage)
    JSON.parse(localStorage.getItem('wanda_seen_posts') || '[]')
  ),
  drawerCategories: new Set(),
  drawerTags: [],
  posts: [],
  userReactions: JSON.parse(localStorage.getItem('wanda_reactions') || '{}'),
  userReports: JSON.parse(localStorage.getItem('wanda_reports') || '{}'),
  theme: localStorage.getItem('wanda_theme') || 'papier',
  emojiAnim: localStorage.getItem('wanda_emoji_anim') || 'seisme',
  soundEnabled: localStorage.getItem('wanda_sound_enabled') !== 'false',
  hapticEnabled: localStorage.getItem('wanda_haptic_enabled') !== 'false',
  wallSearchQuery: ''
};

const REACTION_DEFS = [
  { type: 'wanda', emoji: '🤯', label: 'Wanda' },
  { type: 'courage', emoji: '💪', label: 'Courage' },
  { type: 'mdr', emoji: '😂', label: 'MDR' },
  { type: 'priere', emoji: '🙏', label: 'Prière' },
  { type: 'chaud', emoji: '🔥', label: 'Chaud' }
];

// ==========================================
// MOTEUR AUDIO (Web Audio API - Zéro MP3)
// ==========================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Son d'impact tactile physique pour le bouton Wanda
function playTactileClick() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.12);
    
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch (e) {
    // Audio silencieux si non supporté
  }
}

// Son Dopamine pour les réactions emojis (multi-modes synthétisés)
function playEmojiPop(mode = 'explosion') {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (mode === 'seisme' || mode === 'trou_noir') {
      // Sub-bass rumble boom
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.35);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.36);
    } else if (mode === 'supernova') {
      // Laser rise then boom
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.linearRampToValueAtTime(700, now + 0.1);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.4);
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.41);
    } else if (mode === 'foudre') {
      // Électrique crack / thunder
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.26);
    } else if (mode === 'punch') {
      // Punch impact
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.17);
    } else {
      // Carillon / pop cristallin classique
      osc.type = 'sine';
      const baseFreq = 420 + Math.random() * 120;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, now + 0.08);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(now + 0.16);
    }
  } catch (e) {}
}

// Vibration tactile mobile
function triggerHaptic(pattern = [20]) {
  if (!state.hapticEnabled) return;
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

// ==========================================
// NAVIGATION & ONGLETS
// ==========================================
const viewCounter = document.getElementById('view-counter');
const viewWall = document.getElementById('view-wall');
const navBtnCounter = document.getElementById('nav-btn-counter');
const navBtnWall = document.getElementById('nav-btn-wall');
const navBtnCreate = document.getElementById('nav-btn-create');
const btnGotoWall = document.getElementById('btn-goto-wall');

function switchTab(tabName) {
  state.activeTab = tabName;
  if (tabName === 'counter') {
    viewCounter.classList.add('active');
    viewWall.classList.remove('active');
    navBtnCounter.classList.add('active');
    navBtnWall.classList.remove('active');
  } else if (tabName === 'wall') {
    viewCounter.classList.remove('active');
    viewWall.classList.add('active');
    navBtnCounter.classList.remove('active');
    navBtnWall.classList.add('active');
    loadPosts();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navBtnCounter.addEventListener('click', () => switchTab('counter'));
navBtnWall.addEventListener('click', () => switchTab('wall'));
btnGotoWall.addEventListener('click', () => switchTab('wall'));

// ==========================================
// COMPTEUR EN TEMPS RÉEL
// ==========================================
const counterValueEl = document.getElementById('counter-value');
const btnWandaMain = document.getElementById('btn-wanda-main');

function formatNumber(num) {
  return new Intl.NumberFormat('fr-FR').format(num);
}

const counterStatusBanner = document.getElementById('counter-status-banner');

async function fetchCounter() {
  let data = null;

  try {
    const res = await fetch(`${API_URL}/counter`);

    if (res.ok) {
      data = await res.json();
      state.counterValue = data.total;
      counterValueEl.textContent = formatNumber(data.total);
    } else {
      // 503 : compteur réellement indisponible. On masque la valeur plutôt que
      // de laisser un « 0 » qui se lit comme un vrai décompte.
      state.counterValue = null;
      counterValueEl.textContent = '—';
      if (counterStatusBanner) {
        counterStatusBanner.hidden = false;
        counterStatusBanner.textContent = 'Compteur indisponible.';
      }
    }
  } catch (err) {
    console.error('Erreur chargement compteur', err);
    state.counterValue = null;
    counterValueEl.textContent = '—';
    if (counterStatusBanner) {
      counterStatusBanner.hidden = false;
      counterStatusBanner.textContent = 'Compteur indisponible.';
    }
  }
}

async function handleWandaClick() {
  playTactileClick();
  triggerHaptic([30, 40, 20]);

  // Incrément optimiste immédiat.
  // Si le compteur était marqué indisponible (null), on ne repart pas de 1 :
  // le serveur fera foi dès la réponse.
  if (typeof state.counterValue === 'number') {
    state.counterValue += 1;
    counterValueEl.textContent = formatNumber(state.counterValue);
  }
  counterValueEl.classList.remove('bump');
  void counterValueEl.offsetWidth; // Force reflow
  counterValueEl.classList.add('bump');

  let rank = null;
  let failed = false;

  try {
    const res = await fetch(`${API_URL}/counter/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken
      }
    });

    if (res.ok) {
      const data = await res.json();
      rank = data.rank || null;
      // Le total fait autorité sur l'estimation optimiste.
      if (typeof data.total === 'number') {
        state.counterValue = data.total;
        counterValueEl.textContent = formatNumber(data.total);
      }
    } else {
      // Le serveur a refusé (503 le plus souvent). On ne prétend pas que le
      // vote a été compté : on prévient, sinon le chiffre affiché ment.
      failed = true;
    }
  } catch (e) {
    failed = true;
  }

  if (failed) {
    if (typeof state.counterValue === 'number') {
      state.counterValue = Math.max(0, state.counterValue - 1);
      counterValueEl.textContent = formatNumber(state.counterValue);
    }
    showToast("Compteur indisponible. Ton wanda n'a pas été compté.", 'error');
    return;
  }

  // Ouvrir le tiroir pour proposer d'écrire son Wanda
  openDrawer(rank);
}

btnWandaMain.addEventListener('click', handleWandaClick);

// ==========================================
// TIROIR DE PUBLICATION (BOTTOM SHEET)
// ==========================================
const drawerBackdrop = document.getElementById('drawer-backdrop');
const postDrawer = document.getElementById('post-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const btnSkipDrawer = document.getElementById('btn-skip-drawer');
const drawerSubtitle = document.getElementById('drawer-subtitle');
const wandaForm = document.getElementById('wanda-form');
const postText = document.getElementById('post-text');
const charCount = document.getElementById('char-count');
const btnSubmitWanda = document.getElementById('btn-submit-wanda');
const MAX_POST_LENGTH = Number(postText.getAttribute('maxlength')) || 140;
const formTagInput = document.getElementById('form-tag-input');
const formTagAdd = document.getElementById('form-tag-add');
const formTagSuggestions = document.getElementById('form-tag-suggestions');
const formTagsList = document.getElementById('form-tags-list');
const formTagsCounter = document.getElementById('form-tags-counter');
const wallSearchInput = document.getElementById('wall-search-input');
const wallSearchPanel = document.getElementById('wall-search-panel');
const btnToggleSearch = document.getElementById('btn-toggle-search');
const wallSearchClear = document.getElementById('wall-search-clear');
const wallSearchSuggestions = document.getElementById('wall-search-suggestions');

/**
 * Formate un rang en français : 1re, 2e, 3e…
 *
 * Le compteur renvoie désormais le VRAI rang de la personne parmi les
 * participants du jour, donc « Tu es la 248e personne » est enfin exact. La
 * première personne doit se lire « 1re », pas « 1e ».
 */
function formatRank(n) {
  return n === 1 ? '1re' : `${formatNumber(n)}e`;
}

function openDrawer(rank = null) {
  if (rank) {
    drawerSubtitle.textContent = `Tu es la ${formatRank(rank)} personne à wanda aujourd'hui. Raconte ta galère !`;
  } else {
    drawerSubtitle.textContent = "140 caractères anonymes • Zéro filtre, zéro jugement";
  }
  drawerBackdrop.classList.add('active');
  postDrawer.classList.add('active');
  setTimeout(() => postText.focus(), 300);
}

function normalizeTagSlugUI(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length === 0 || s.length > 30) return null;
  return s;
}

function normalizeTagDisplayUI(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/^#+/, '').replace(/\s+/g, ' ');
  if (s.length === 0 || s.length > 30) return null;
  return s;
}

function renderFormTags() {
  if (!formTagsList) return;
  formTagsList.innerHTML = '';
  if (formTagsCounter) formTagsCounter.textContent = `${state.drawerTags.length}/5`;
  state.drawerTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'form-tag-chip';
    chip.innerHTML = `#${tag.display} <button type="button" aria-label="Retirer">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.drawerTags.splice(idx, 1);
      renderFormTags();
    });
    formTagsList.appendChild(chip);
  });
}

function addFormTag(raw) {
  if (state.drawerTags.length >= 5) {
    showToast('Maximum 5 hashtags par publication', 'error');
    return;
  }
  const slug = normalizeTagSlugUI(raw);
  const display = normalizeTagDisplayUI(raw);
  if (!slug || !display) {
    showToast('Hashtag invalide', 'error');
    return;
  }
  if (state.drawerTags.some(t => t.slug === slug)) {
    showToast('Hashtag déjà ajouté', 'error');
    return;
  }
  state.drawerTags.push({ slug, display });
  renderFormTags();
  if (formTagInput) formTagInput.value = '';
  setElementHidden(formTagSuggestions, true);
}

function closeDrawer() {
  drawerBackdrop.classList.remove('active');
  postDrawer.classList.remove('active');
  wandaForm.reset();
  state.drawerCategories.clear();
  state.drawerTags = [];
  renderFormTags();
  if (formTagInput) formTagInput.value = '';
  setElementHidden(formTagSuggestions, true);
  charCount.textContent = '140';
}

navBtnCreate.addEventListener('click', () => openDrawer());
btnCloseDrawer.addEventListener('click', closeDrawer);
btnSkipDrawer.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// Compteur dynamique de caractères
function updateCharCount() {
  const remaining = MAX_POST_LENGTH - postText.value.length;

  // Une valeur posée par script peut dépasser `maxlength` : le compteur ne
  // doit jamais afficher un nombre négatif ni laisser envoyer ce texte.
  charCount.textContent = Math.max(0, remaining);
  btnSubmitWanda.disabled = postText.value.length > MAX_POST_LENGTH;
  if (remaining < 20) {
    charCount.style.color = 'var(--color-wanda-red)';
  } else {
    charCount.style.color = 'var(--text-sub)';
  }
}

postText.addEventListener('input', updateCharCount);
updateCharCount();

if (formTagAdd) {
  formTagAdd.addEventListener('click', () => {
    if (formTagInput) addFormTag(formTagInput.value);
  });
}
if (formTagInput) {
  formTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFormTag(formTagInput.value);
    }
  });
  let tagSuggestTimer;
  formTagInput.addEventListener('input', () => {
    clearTimeout(tagSuggestTimer);
    const val = formTagInput.value.trim();
    if (!val || !formTagSuggestions) {
      setElementHidden(formTagSuggestions, true);
      formTagSuggestions.innerHTML = '';
      return;
    }
    tagSuggestTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/tags/suggest?q=${encodeURIComponent(val)}&limit=8`);
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
          setElementHidden(formTagSuggestions, true);
          formTagSuggestions.innerHTML = '';
          return;
        }
        formTagSuggestions.innerHTML = '';
        data.forEach(item => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-suggest-item';
          btn.textContent = `#${item.display || item.slug}`;
          btn.addEventListener('click', () => {
            addFormTag(item.display || item.slug);
          });
          formTagSuggestions.appendChild(btn);
        });
        setElementHidden(formTagSuggestions, false);
      } catch (e) {
        setElementHidden(formTagSuggestions, true);
      }
    }, 200);
  });
}

// Soumission du formulaire
wandaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = postText.value.trim();

  if (!text) return;

  const tagsToSend = state.drawerTags.map(t => t.display || t.slug);
  const categoriesToSend = tagsToSend.map(t => `#${t}`);

  const payload = {
    texte: text,
    categories: categoriesToSend,
    tags: tagsToSend,
    clientToken: clientToken
  };

  try {
    const res = await fetch(`${API_URL}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || "Erreur lors de la publication", "error");
      return;
    }

    closeDrawer();
    showToast("Ton wanda a été déposé sur Le Mur !", "success");
    switchTab('wall');
  } catch (err) {
    showToast("Impossible d'envoyer le message. Vérifie ta connexion.", "error");
  }
});


// ==========================================
// LE MUR DES WANDAS (POSTS FEED)
// ==========================================
const postsStream = document.getElementById('posts-stream');
const wallLoading = document.getElementById('wall-loading');
const btnRefreshPosts = document.getElementById('btn-refresh-posts');
const categoryPills = document.querySelectorAll('.cat-pill');
const sortTabButtons = document.querySelectorAll('.sort-tab');

// ---- Handlers : Onglets de tri ----
sortTabButtons.forEach(tab => {
  tab.addEventListener('click', () => {
    sortTabButtons.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-pressed', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-pressed', 'true');
    state.sortMode = tab.getAttribute('data-sort');
    // Réinitialiser la déduplication lors d'un changement de tri
    loadPosts(true);
  });
});

// ---- Handlers : Filtres catégories ----
categoryPills.forEach(pill => {
  pill.addEventListener('click', () => {
    categoryPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.selectedCategory = pill.getAttribute('data-category');
    loadPosts(true);
  });
});

btnRefreshPosts.addEventListener('click', () => {
  triggerHaptic([15]);
  loadPosts(true);
});

/**
 * Persistance des posts vus (localStorage cap à 200 IDs max)
 */
function markPostsAsSeen(posts) {
  posts.forEach(p => state.seenPostIds.add(p.id));
  const arr = Array.from(state.seenPostIds).slice(-200);
  localStorage.setItem('wanda_seen_posts', JSON.stringify(arr));
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "À l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days} j`;
}

/**
 * Charge les posts depuis l'API
 * @param {boolean} reset - true = recharge complète (efface le stream)
 */
async function loadPosts(reset = false) {
  if (reset) {
    setElementVisible(wallLoading, true);
    postsStream.innerHTML = '';
  }

  try {
    // Paramètres de requête
    const params = new URLSearchParams({ sort: state.sortMode, limit: '50' });

    if (state.selectedCategory !== 'Tous') {
      params.set('category', state.selectedCategory);
    }

    // Envoyer les IDs des posts déjà vus (max 30) pour que le backend priorise les inédits
    if (state.seenPostIds.size > 0 && state.sortMode === 'hot') {
      const recentSeen = Array.from(state.seenPostIds).slice(-30).join(',');
      params.set('seen', recentSeen);
    }

    const res = await fetch(`${API_URL}/posts?${params.toString()}`);
    if (!res.ok) {
      // Sur une route `/api/posts` valide, une 503 contient un message JSON.
      // Ne pas supposer ce format : un proxy ou une page d'erreur HTML doit
      // produire la même erreur lisible côté client.
      let message = 'Mur indisponible. Réessaie dans un instant.';
      try {
        const erreur = await res.json();
        if (erreur && typeof erreur.error === 'string' && erreur.error.trim()) {
          message = erreur.error.trim();
        }
      } catch (_) {
        // Corps non JSON : conserver le message générique ci-dessus.
      }
      throw new Error(message);
    }

    const posts = await res.json();
    if (!Array.isArray(posts)) {
      throw new Error('Réponse inattendue du serveur.');
    }

    state.posts = posts;

    // Marquer les posts chargés comme vus
    markPostsAsSeen(posts);

    renderPosts(posts, reset);
  } catch (err) {
    // L'erreur doit s'afficher dans tous les cas, pas seulement sur un
    // rechargement explicite : `switchTab('wall')` appelle `loadPosts()` sans
    // `reset`, et une panne réseau produisait sinon un mur vide silencieux.
    postsStream.innerHTML = `
      <div class="empty-state">
        <p>Impossible de charger les wandas.</p>
        <p class="empty-hint">Vérifie ta connexion et réessaie.</p>
      </div>
    `;
  } finally {
    setElementVisible(wallLoading, false);
  }
}

// ---- Polling : badge "Nouveau" sur l'onglet Récents ----
let lastKnownPostId = null;
let newPostCount = 0;

async function pollNewPosts() {
  if (state.activeTab !== 'wall') return;

  try {
    const res = await fetch(`${API_URL}/posts?sort=recent&limit=1`);
    const latest = await res.json();
    if (latest && latest[0]) {
      const topId = latest[0].id;
      if (lastKnownPostId === null) {
        lastKnownPostId = topId;
      } else if (topId !== lastKnownPostId && !state.seenPostIds.has(topId)) {
        newPostCount++;
        updateRecentBadge(newPostCount);
        lastKnownPostId = topId;
      }
    }
  } catch (_) { /* silencieux */ }
}

function updateRecentBadge(count) {
  const recentTab = document.querySelector('.sort-tab[data-sort="recent"]');
  if (!recentTab) return;
  let badge = recentTab.querySelector('.new-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'new-badge';
    recentTab.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
}

function clearRecentBadge() {
  const badge = document.querySelector('.sort-tab[data-sort="recent"] .new-badge');
  if (badge) badge.remove();
  newPostCount = 0;
}

// Effacer le badge quand on clique sur "Récents"
document.querySelector('.sort-tab[data-sort="recent"]')?.addEventListener('click', clearRecentBadge);

// Polling toutes les 30 secondes
setInterval(pollNewPosts, 30000);



/**
 * Marque visuellement un signalement déjà transmis et le mémorise.
 *
 * Avant, le bouton revenait à son état initial après l'envoi : rien ne disait
 * « c'est fait ». Le marquage persiste dans le navigateur comme les réactions.
 */
function markReportButtonAsSent(button) {
  button.classList.add('reported');
  button.disabled = true;
  button.setAttribute('aria-pressed', 'true');
  button.title = 'Tu as déjà signalé ce wanda';
}

function saveUserReport(postId, button) {
  state.userReports[postId] = true;
  localStorage.setItem('wanda_reports', JSON.stringify(state.userReports));
  markReportButtonAsSent(button);
}

function renderPosts(posts) {
  if (!posts || posts.length === 0) {
    postsStream.innerHTML = `
      <div class="empty-state">
        <p>Aucun wanda pour le moment dans cette catégorie.</p>
        <p class="empty-hint">Sois le premier à raconter ta galère !</p>
      </div>
    `;
    return;
  }

  postsStream.innerHTML = '';
  posts.forEach(post => {
    const card = createPostCard(post);
    postsStream.appendChild(card);
  });
}

function createPostCard(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.id = `post-${post.id}`;

  const tagsHtml = (post.categories || [])
    .map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
    .join('');

  // Les réactions sont accessibles : emoji + libellé ARIA.
  const reactionsHtml = REACTION_DEFS.map(def => {
    const count = post.reactions?.[def.type] || 0;
    const isUserReacted = Boolean(state.userReactions[`${post.id}_${def.type}`]);
    return `
      <button class="btn-reaction ${isUserReacted ? 'active' : ''}"
              type="button"
              data-post-id="${post.id}"
              data-type="${def.type}"
              aria-pressed="${isUserReacted}"
              aria-label="${def.label}, ${count} réaction${count === 1 ? '' : 's'}">
        <span class="emoji" aria-hidden="true">${def.emoji}</span>
        <span class="count">${count}</span>
      </button>
    `;
  }).join('');

  // Texte pour WhatsApp
  const shareText = encodeURIComponent(
    `« ${post.texte} »\n\nAu Cameroun, on encaisse. Ici, on dit. Découvre WANDA : https://wanda237.com`
  );

  card.innerHTML = `
    <div class="post-card-header">
      <div class="post-tags">${tagsHtml}</div>
      <div class="post-meta-right">
        <span class="post-time">${timeAgo(post.created_at)}</span>
        <button class="btn-report" data-post-id="${post.id}" title="Signaler ce post">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
            <line x1="4" y1="22" x2="4" y2="15"></line>
          </svg>
        </button>
      </div>
    </div>

    <p class="post-text">${escapeHtml(post.texte)}</p>

    <div class="post-footer">
      <div class="reactions-row">
        ${reactionsHtml}
      </div>
      <a href="https://api.whatsapp.com/send?text=${shareText}" 
         target="_blank" 
         rel="noopener noreferrer" 
         class="btn-share-whatsapp" 
         title="Partager sur WhatsApp">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12.031 2C6.5 2 2 6.5 2 12.031c0 1.954.563 3.774 1.531 5.313L2.25 21.75l4.563-1.25c1.469.875 3.188 1.375 5.218 1.375 5.531 0 10.031-4.5 10.031-10.031S17.563 2 12.031 2zm0 18.063c-1.781 0-3.438-.5-4.844-1.375l-.344-.219-2.719.75.75-2.656-.219-.344c-1-1.469-1.563-3.188-1.563-5.063 0-4.438 3.625-8.063 8.063-8.063 4.438 0 8.063 3.625 8.063 8.063 0 4.438-3.625 8.063-8.063 8.063zm4.438-6.031c-.25-.125-1.469-.719-1.688-.813-.219-.094-.375-.125-.531.125-.156.25-.625.813-.781.969-.156.156-.281.188-.531.063-.25-.125-1.063-.375-2.031-1.219-.75-.688-1.281-1.5-1.438-1.75-.156-.25-.031-.375.094-.5.125-.125.25-.281.375-.438.125-.156.156-.25.25-.438.094-.188.031-.344-.031-.469-.063-.125-.531-1.281-.719-1.75-.188-.469-.375-.406-.531-.406h-.469c-.156 0-.438.063-.656.313-.219.25-.875.844-.875 2.063s.906 2.406 1.031 2.563c.125.188 1.781 2.719 4.313 3.813.625.281 1.094.438 1.469.563.625.188 1.188.156 1.625.094.5-.063 1.469-.594 1.688-1.188.219-.594.219-1.094.156-1.188-.063-.094-.219-.156-.469-.281z"/>
        </svg>
      </a>
    </div>
  `;

  // Écouteurs de réactions
  card.querySelectorAll('.btn-reaction').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = btn.getAttribute('data-type');
      const postId = btn.getAttribute('data-post-id');
      handleReaction(postId, type, btn, e);
    });
  });

  // Écouteur de signalement
  const reportBtn = card.querySelector('.btn-report');
  if (state.userReports[post.id]) {
    markReportButtonAsSent(reportBtn);
  }
  reportBtn.addEventListener('click', () => {
    handleReport(post.id, card);
  });

  return card;
}

// ==========================================
// EFFETS PARTICULES (10 MODES DE DOPAMINE)
// ==========================================
function spawnEmojiParticles(x, y, emoji) {
  const mode = state.emojiAnim || 'seisme';
  playEmojiPop(mode);

  const appLayout = document.querySelector('.app-layout');

  // Mode 10 : Sobre (micro-pulsation sans particules)
  if (mode === 'sobre') {
    triggerHaptic([15]);
    return;
  }

  // Mode 1 : Méga-Choc / Onde de Choc
  if (mode === 'seisme') {
    triggerHaptic([40, 50, 40]);
    if (appLayout) {
      appLayout.classList.remove('screen-shake');
      void appLayout.offsetWidth;
      appLayout.classList.add('screen-shake');
      setTimeout(() => appLayout.classList.remove('screen-shake'), 400);
    }

    const mega = document.createElement('div');
    mega.className = 'particle-emoji particle-seisme';
    mega.textContent = emoji;
    document.body.appendChild(mega);
    setTimeout(() => mega.remove(), 800);
    return;
  }

  // Mode 2 : Supernova / Flash Cosmique
  if (mode === 'supernova') {
    triggerHaptic([20, 30, 80]);
    if (appLayout) {
      appLayout.classList.remove('screen-shake');
      void appLayout.offsetWidth;
      appLayout.classList.add('screen-shake');
      setTimeout(() => appLayout.classList.remove('screen-shake'), 450);
    }

    // Anneau d'onde de choc dorée
    const ring = document.createElement('div');
    ring.className = 'shockwave-ring';
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 800);

    // Emoji Supernova géant
    const nova = document.createElement('div');
    nova.className = 'particle-emoji particle-supernova';
    nova.textContent = emoji;
    document.body.appendChild(nova);
    setTimeout(() => nova.remove(), 900);

    // Étincelles radiales
    for (let i = 0; i < 12; i++) {
      const spark = document.createElement('div');
      spark.className = 'particle-emoji particle-explosion';
      spark.textContent = '✨';
      const angle = (Math.PI * 2 * i) / 12;
      const dist = 90 + Math.random() * 80;
      spark.style.left = `${window.innerWidth / 2}px`;
      spark.style.top = `${window.innerHeight / 2}px`;
      spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      document.body.appendChild(spark);
      setTimeout(() => spark.remove(), 850);
    }
    return;
  }

  // Mode 3 : Coup de Foudre / Impact Électrique
  if (mode === 'foudre') {
    triggerHaptic([15, 15, 60]);
    if (appLayout) {
      appLayout.classList.remove('flash-screen-lightning');
      void appLayout.offsetWidth;
      appLayout.classList.add('flash-screen-lightning');
      setTimeout(() => appLayout.classList.remove('flash-screen-lightning'), 400);
    }

    const bolt = document.createElement('div');
    bolt.className = 'particle-emoji particle-foudre';
    bolt.textContent = emoji;
    document.body.appendChild(bolt);
    setTimeout(() => bolt.remove(), 750);

    // Éclats électriques
    for (let i = 0; i < 8; i++) {
      const spark = document.createElement('div');
      spark.className = 'particle-emoji particle-explosion';
      spark.textContent = '⚡';
      const angle = (Math.PI * 2 * i) / 8;
      const dist = 70 + Math.random() * 90;
      spark.style.left = `${window.innerWidth / 2}px`;
      spark.style.top = `${window.innerHeight / 2}px`;
      spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      document.body.appendChild(spark);
      setTimeout(() => spark.remove(), 750);
    }
    return;
  }

  // Mode 4 : Pluie de Météores / Déluge
  if (mode === 'meteore') {
    triggerHaptic([20, 20, 20, 40]);
    if (appLayout) {
      appLayout.classList.remove('screen-shake');
      void appLayout.offsetWidth;
      appLayout.classList.add('screen-shake');
      setTimeout(() => appLayout.classList.remove('screen-shake'), 400);
    }

    const count = 18;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const met = document.createElement('div');
        met.className = 'particle-emoji particle-meteore';
        met.textContent = emoji;
        const startX = Math.random() * (window.innerWidth + 100) - 50;
        const startY = -40;
        const dx = 120 + Math.random() * 100;
        const dy = window.innerHeight + 100;

        met.style.left = `${startX}px`;
        met.style.top = `${startY}px`;
        met.style.setProperty('--dx', `${dx}px`);
        met.style.setProperty('--dy', `${dy}px`);
        document.body.appendChild(met);
        setTimeout(() => met.remove(), 850);
      }, i * 35);
    }
    return;
  }

  // Mode 5 : Trou Noir / Implosion-Blast
  if (mode === 'trou_noir') {
    triggerHaptic([25, 40, 70]);
    if (appLayout) {
      appLayout.classList.remove('screen-shake');
      void appLayout.offsetWidth;
      appLayout.classList.add('screen-shake');
      setTimeout(() => appLayout.classList.remove('screen-shake'), 500);
    }

    const bh = document.createElement('div');
    bh.className = 'particle-emoji particle-trou_noir';
    bh.textContent = emoji;
    document.body.appendChild(bh);
    setTimeout(() => bh.remove(), 950);
    return;
  }

  // Mode 6 : K.O. Punch / Impact Brutal
  if (mode === 'punch') {
    triggerHaptic([60]);
    if (appLayout) {
      appLayout.classList.remove('punch-zoom');
      void appLayout.offsetWidth;
      appLayout.classList.add('punch-zoom');
      setTimeout(() => appLayout.classList.remove('punch-zoom'), 450);
    }

    const punch = document.createElement('div');
    punch.className = 'particle-emoji particle-punch';
    punch.textContent = emoji;
    document.body.appendChild(punch);
    setTimeout(() => punch.remove(), 700);

    // Étoiles de choc cartoon
    for (let i = 0; i < 6; i++) {
      const star = document.createElement('div');
      star.className = 'particle-emoji particle-explosion';
      star.textContent = '💥';
      const angle = (Math.PI * 2 * i) / 6;
      const dist = 75 + Math.random() * 60;
      star.style.left = `${window.innerWidth / 2}px`;
      star.style.top = `${window.innerHeight / 2}px`;
      star.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      star.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 700);
    }
    return;
  }

  // Modes classiques : Particules multiples (Explosion 360, Geyser, Vortex)
  triggerHaptic([15, 20]);
  const count = mode === 'vortex' ? 8 : 10;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = `particle-emoji particle-${mode}`;
    particle.textContent = emoji;

    let dx, dy;
    if (mode === 'geyser') {
      dx = (Math.random() - 0.5) * 90;
      dy = -(110 + Math.random() * 110);
    } else if (mode === 'vortex') {
      const angle = (Math.PI * 2 * i) / count;
      const radius = 55 + Math.random() * 55;
      dx = Math.cos(angle) * radius;
      dy = Math.sin(angle) * radius - 20;
    } else {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5);
      const distance = 60 + Math.random() * 80;
      dx = Math.cos(angle) * distance;
      dy = Math.sin(angle) * distance - 30;
    }

    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.setProperty('--dx', `${dx}px`);
    particle.style.setProperty('--dy', `${dy}px`);

    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 950);
  }
}

async function handleReaction(postId, type, btn, event) {
  const rect = btn.getBoundingClientRect();
  const emoji = btn.querySelector('.emoji').textContent;
  const countEl = btn.querySelector('.count');
  const key = `${postId}_${type}`;
  const isAlreadyActive = btn.classList.contains('active');

  // Explosion au clic
  spawnEmojiParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, emoji);

  // Mise à jour optimiste
  let currentCount = parseInt(countEl.textContent, 10) || 0;
  if (isAlreadyActive) {
    btn.classList.remove('active');
    countEl.textContent = Math.max(0, currentCount - 1);
    delete state.userReactions[key];
  } else {
    btn.classList.add('active');
    countEl.textContent = currentCount + 1;
    state.userReactions[key] = true;
  }
  localStorage.setItem('wanda_reactions', JSON.stringify(state.userReactions));

  // Requête API
  try {
    const res = await fetch(`${API_URL}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken
      },
      body: JSON.stringify({ postId: parseInt(postId, 10), type })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.reactions && data.reactions[type] !== undefined) {
      countEl.textContent = data.reactions[type];
    }
  } catch (err) {
    // L'écriture a échoué : on annule la mise à jour optimiste plutôt que de
    // laisser une réaction qui n'existe pas côté serveur. Avant, l'erreur était
    // avalée silencieusement et le compteur local mentait.
    btn.classList.toggle('active', !isAlreadyActive);
    countEl.textContent = currentCount;
    if (isAlreadyActive) {
      state.userReactions[key] = true;
    } else {
      delete state.userReactions[key];
    }
    localStorage.setItem('wanda_reactions', JSON.stringify(state.userReactions));
    showToast('Réaction non enregistrée. Réessaie.', 'error');
  }
}

async function handleReport(postId, card) {
  if (!confirm("Voulez-vous signaler ce wanda pour non-respect des règles (haine, politique, vulgarité) ?")) {
    return;
  }

  try {
    const res = await fetch(`${API_URL}/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken
      },
      body: JSON.stringify({ postId })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showToast(data.error || "Signalement impossible pour le moment.", 'error');
      return;
    }

    if (data.hidden) {
      card.remove();
      showToast("Publication masquée suite à plusieurs signalements.", "success");
    } else if (data.alreadyReported) {
      saveUserReport(postId, card.querySelector('.btn-report'));
      showToast("Tu avais déjà signalé ce wanda.", "info");
    } else {
      saveUserReport(postId, card.querySelector('.btn-report'));
      showToast("Signalement bien reçu par la communauté.", "success");
    }
  } catch (err) {
    // Plus de « Signalement enregistré » sur erreur : le signalement n'a pas
    // été transmis, le dire serait faux.
    showToast("Signalement non transmis. Vérifie ta connexion.", 'error');
  }
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// GESTION DES PARAMÈTRES & THÈMES
// ==========================================
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsDrawer = document.getElementById('settings-drawer');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnOpenSettingsWall = document.getElementById('btn-open-settings-wall');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnTestAnim = document.getElementById('btn-test-anim');
const toggleSound = document.getElementById('toggle-sound');
const toggleHaptic = document.getElementById('toggle-haptic');
const themeCards = document.querySelectorAll('.theme-card');
const animRadios = document.querySelectorAll('input[name="emoji-anim"]');

function openSettings() {
  settingsBackdrop.classList.add('active');
  settingsDrawer.classList.add('active');
}

function closeSettings() {
  settingsBackdrop.classList.remove('active');
  settingsDrawer.classList.remove('active');
}

if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettings);
if (btnOpenSettingsWall) btnOpenSettingsWall.addEventListener('click', openSettings);
if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

// Application du thème
function applyTheme(themeName) {
  state.theme = themeName;
  document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('wanda_theme', themeName);

  themeCards.forEach(card => {
    if (card.getAttribute('data-theme') === themeName) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

themeCards.forEach(card => {
  card.addEventListener('click', () => {
    const theme = card.getAttribute('data-theme');
    applyTheme(theme);
    triggerHaptic([15]);
    playTactileClick();
    showToast(`Thème activé : ${card.querySelector('.theme-name').textContent}`, 'success');
  });
});

// Choix de l'animation d'emoji
animRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    state.emojiAnim = radio.value;
    localStorage.setItem('wanda_emoji_anim', radio.value);
    triggerHaptic([15]);
    playEmojiPop();
  });
});

// Bouton tester la réponse des réactions
if (btnTestAnim) {
  btnTestAnim.addEventListener('click', () => {
    const randomEmoji = REACTION_DEFS[Math.floor(Math.random() * REACTION_DEFS.length)].emoji;
    spawnEmojiParticles(window.innerWidth / 2, window.innerHeight / 2, randomEmoji);
  });
}

// Toggles Sons & Haptique
if (toggleSound) {
  toggleSound.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    localStorage.setItem('wanda_sound_enabled', state.soundEnabled);
    if (state.soundEnabled) playTactileClick();
  });
}

if (toggleHaptic) {
  toggleHaptic.addEventListener('change', (e) => {
    state.hapticEnabled = e.target.checked;
    localStorage.setItem('wanda_haptic_enabled', state.hapticEnabled);
    if (state.hapticEnabled) triggerHaptic([30]);
  });
}

// ==========================================
// INITIALISATION & PWA SERVICE WORKER
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // Appliquer le thème sauvegardé
  applyTheme(state.theme);

  // Appliquer le choix d'animation
  const activeRadio = document.querySelector(`input[name="emoji-anim"][value="${state.emojiAnim}"]`);
  if (activeRadio) activeRadio.checked = true;

  // Appliquer l'état des switches
  if (toggleSound) toggleSound.checked = state.soundEnabled;
  if (toggleHaptic) toggleHaptic.checked = state.hapticEnabled;

  fetchCounter();

  // Enregistrement du Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('WANDA PWA Service Worker actif'))
      .catch(err => console.warn('PWA non enregistrée', err));
  }
});

function setSearchOpen(open) {
  setElementHidden(wallSearchPanel, !open);
  if (btnToggleSearch) {
    btnToggleSearch.classList.toggle('active', open);
    btnToggleSearch.setAttribute('aria-expanded', String(open));
    btnToggleSearch.setAttribute('aria-label', open ? 'Fermer la recherche' : 'Rechercher');
    btnToggleSearch.setAttribute('title', open ? 'Fermer la recherche' : 'Rechercher');
  }
  if (open) {
    window.setTimeout(() => wallSearchInput?.focus(), 90);
  }
}

if (btnToggleSearch && wallSearchPanel) {
  btnToggleSearch.addEventListener('click', () => {
    const alreadyOpen = !wallSearchPanel.classList.contains('is-hidden');
    setSearchOpen(!alreadyOpen);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && wallSearchPanel && !wallSearchPanel.classList.contains('is-hidden')) {
    setSearchOpen(false);
    btnToggleSearch?.focus();
  }
});

// Recherche sur le mur
if (wallSearchInput) {
  wallSearchInput.addEventListener('input', () => {
    const val = wallSearchInput.value.trim();
    setElementHidden(wallSearchClear, !val);
    state.wallSearchQuery = val;
    if (val.length >= 2) {
      performWallSearch(val);
    } else {
      if (wallSearchSuggestions) {
        setElementHidden(wallSearchSuggestions, true);
        wallSearchSuggestions.innerHTML = '';
      }
      loadPosts(false);
    }
  });
}
if (wallSearchClear) {
  wallSearchClear.addEventListener('click', () => {
    if (wallSearchInput) wallSearchInput.value = '';
    setElementHidden(wallSearchClear, true);
    state.wallSearchQuery = '';
    if (wallSearchSuggestions) {
      setElementHidden(wallSearchSuggestions, true);
      wallSearchSuggestions.innerHTML = '';
    }
    loadPosts(false);
  });
}

async function performWallSearch(q) {
  try {
    const res = await fetch(`${API_URL}/posts/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const postsStream = document.getElementById('posts-stream');
    const wallLoading = document.getElementById('wall-loading');
    setElementVisible(wallLoading, false);
    if (!postsStream) return;
    postsStream.innerHTML = '';
    if (wallSearchSuggestions) {
      wallSearchSuggestions.innerHTML = '';
      if (Array.isArray(data.tags) && data.tags.length > 0) {
        data.tags.slice(0, 6).forEach(tag => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'wall-suggest-tag';
          btn.textContent = `#${tag.display || tag.slug} (${tag.usage_count || 0})`;
          btn.addEventListener('click', () => {
            if (wallSearchInput) wallSearchInput.value = tag.display || tag.slug;
            state.wallSearchQuery = tag.display || tag.slug;
            setElementHidden(wallSearchClear, false);
            performWallSearch(tag.display || tag.slug);
            if (wallSearchSuggestions) {
              setElementHidden(wallSearchSuggestions, true);
            }
          });
          wallSearchSuggestions.appendChild(btn);
        });
        setElementHidden(wallSearchSuggestions, false);
      } else {
        setElementHidden(wallSearchSuggestions, true);
      }
    }
    if (!Array.isArray(data.posts) || data.posts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wall-empty';
      empty.innerHTML = '<p>Aucun résultat pour cette recherche.</p>';
      postsStream.appendChild(empty);
      return;
    }
    data.posts.forEach(post => {
      if (typeof renderPost === 'function') {
        renderPost(post);
      } else {
        // fallback minimal
        const postEl = document.createElement('article');
        postEl.className = 'post-card';
        postEl.innerHTML = `<div class="post-text">${escapeHtml(post.texte)}</div>`;
        postsStream.appendChild(postEl);
      }
    });
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
