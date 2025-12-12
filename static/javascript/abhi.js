// static/js/main.js
// Consolidated main JavaScript for search, watchlist, rating, and profile upload
// IMPORTANT:
// - Put <meta name="toggle-watchlist-url" content="{% url 'toggle_watchlist' %}"> and
//   <meta name="rating-submit-url" content="{% url 'submit_rating' %}"> in your base.html head
// - Load this script near the end of <body> (after DOM elements it references)

/* =========================
   GLOBAL CONSTANTS & HELPERS
   ========================= */

const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const resultsContainer = document.getElementById('results-container');
let selectedRating = 0;
let currentMovieId = null; // Used by the rating modal

// CSRF helper
function getCookie(name) {
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? v.pop() : '';
}

// HTML escape util
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

// Read endpoint meta tags
function getMetaUrl(name, fallback) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta ? meta.content : (fallback || null);
}


/* ========== SEARCH AUTOCOMPLETE / SUGGESTIONS ========== */

/*
Requires:
- An input with id="movie-search-input"
- A container where suggestions will be inserted (created by this script)
- A global function searchMovies(query) which performs the full search
*/

(function () {
  const input = document.getElementById('movie-search-input');
  if (!input) return;

  // Create suggestion container
  const container = document.createElement('div');
  container.className = 'search-suggestions';
  container.setAttribute('role', 'listbox');
  container.style.display = 'none';
  container.style.position = 'absolute';
  container.style.zIndex = '1200';
  container.style.width = input.offsetWidth + 'px';
  input.parentNode.style.position = input.parentNode.style.position || 'relative';
  input.parentNode.appendChild(container);

  let suggestions = [];
  let focusedIndex = -1;
  let lastQuery = '';

  // debounce helper
  function debounce(fn, delay) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // position container under input (call on resize)
  function positionContainer() {
    const rect = input.getBoundingClientRect();
    const parentRect = input.parentNode.getBoundingClientRect();
    container.style.top = (input.offsetTop + input.offsetHeight + 6) + 'px';
    container.style.left = input.offsetLeft + 'px';
    container.style.width = input.offsetWidth + 'px';
  }
  window.addEventListener('resize', positionContainer);
  positionContainer();

  // build single suggestion DOM node
  function buildSuggestionNode(s) {
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    el.setAttribute('role', 'option');
    el.setAttribute('data-tmdb-id', s.id || '');
    el.style.padding = '8px 10px';
    el.style.cursor = 'pointer';
    el.style.display = 'flex';
    el.style.gap = '8px';
    el.style.alignItems = 'center';
    el.style.borderBottom = '1px solid rgba(15,23,42,0.05)';
    el.innerHTML = `
      <div class="suggestion-thumb" style="width:40px;height:60px;flex:0 0 40px;">
        ${s.poster_path ? `<img src="https://image.tmdb.org/t/p/w92${s.poster_path}" style="width:40px;height:60px;object-fit:cover;border-radius:4px" />` : `<div style="width:40px;height:60px;background:#f0f2f7;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#9aa0b4;font-size:11px">No</div>`}
      </div>
      <div style="flex:1;min-width:0">
        <div class="suggestion-title" style="font-weight:600;color:#071135;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.title)}</div>
        <div class="suggestion-meta" style="font-size:12px;color:#64748b;margin-top:4px">${s.release_date ? escapeHtml(s.release_date.slice(0,4)) : 'N/A'}</div>
      </div>
    `;
    return el;
  }

  // render suggestion list
  function renderList(items) {
    suggestions = items || [];
    focusedIndex = -1;
    container.innerHTML = '';
    if (!items || items.length === 0) {
      container.style.display = 'none';
      return;
    }
    items.forEach((it, idx) => {
      const node = buildSuggestionNode(it);
      node.addEventListener('click', () => {
        chooseSuggestion(idx);
      });
      node.addEventListener('mouseenter', () => {
        setFocus(idx);
      });
      container.appendChild(node);
    });
    container.style.display = 'block';
  }

  function setFocus(idx) {
    const children = Array.from(container.children);
    children.forEach((c, i) => {
      c.style.background = i === idx ? 'rgba(123,97,255,0.06)' : '';
      c.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    focusedIndex = idx;
  }

function chooseSuggestion(idx) {
  const s = suggestions[idx];
  if (!s) return;
  input.value = s.title;
  hideList();
  // trigger full search (your existing function)
  if (typeof searchMovies === 'function') {
    // small delay to ensure input value is set before rendering
    setTimeout(() => searchMovies(s.title), 0);
  } else {
    // fallback: submit the search form (only if you rely on server submit)
    input.form?.submit();
  }
}


  function hideList() {
    container.style.display = 'none';
    focusedIndex = -1;
  }

  // fetch suggestions from server
  async function fetchSuggestions(q) {
    lastQuery = q;
    if (!q || q.length < 2) {
      renderList([]);
      return;
    }
    const url = `/api/search-suggest/?q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        renderList([]);
        return;
      }
      const json = await res.json();
      // ensure query hasn't changed since request
      if (input.value.trim() !== lastQuery.trim()) return;
      renderList(json.results || []);
    } catch (err) {
      console.error('Suggest error', err);
      renderList([]);
    }
  }

  const debouncedFetch = debounce(fetchSuggestions, 220);

  // events
  input.addEventListener('input', (e) => {
    positionContainer();
    const q = input.value.trim();
    if (q.length < 2) {
      renderList([]);
      return;
    }
    debouncedFetch(q);
  });

  // keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (container.style.display === 'none') return;
    const count = container.children.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(count - 1, Math.max(0, focusedIndex + 1));
      setFocus(next);
      container.children[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(0, Math.min(count - 1, focusedIndex - 1));
      setFocus(prev);
      container.children[prev]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      if (focusedIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(focusedIndex);
      } else {
        // no suggestion focused; allow normal form submit which triggers searchMovies via submit handler
      }
      return;
    }
    if (e.key === 'Escape') {
      hideList();
      return;
    }
  });

  // click outside closes list
  document.addEventListener('click', (ev) => {
    if (!container.contains(ev.target) && ev.target !== input) {
      hideList();
    }
  });
})();



/* =========================
   SEARCH (backend proxy)
   ========================= */

document.getElementById('search-form')?.addEventListener('submit', function (event) {
  event.preventDefault();
  const query = document.getElementById('movie-search-input')?.value.trim();
  if (query) searchMovies(query);
});

async function searchMovies(query) {
  if (!query || query.length < 3) {
    if (resultsContainer) resultsContainer.innerHTML = '';
    return;
  }

  const url = `/api/search/?q=${encodeURIComponent(query)}`;
  if (resultsContainer) resultsContainer.innerHTML = '<p style="text-align:center;color:#000;font-size:1.1rem;">Searching…</p>';

  const controller = new AbortController();
  const timeoutMs = 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);

    // Read the body once as text
    const raw = await response.text();

    // Try to parse JSON from that single read
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      // Not JSON — keep data as null and handle below
      data = null;
    }

    // If server returned non-OK status, prefer JSON error message, otherwise show raw text
    if (!response.ok) {
      const bodyText = data?.error || data?.message || raw || 'Server returned an error.';
      console.error('Search API returned non-OK status', response.status, bodyText);
      if (resultsContainer) resultsContainer.innerHTML = `<p style="text-align:center;color:red">Error: ${escapeHtml(bodyText)}</p>`;
      return;
    }

    // If we don't have parsed JSON, fail gracefully
    if (!data || !Array.isArray(data.results)) {
      console.error('Unexpected search response shape or non-JSON:', raw);
      if (resultsContainer) resultsContainer.innerHTML = `<p style="text-align:center;color:red">Error: Invalid server response.</p>`;
      return;
    }

    // Normal successful path
    renderResults(data.results);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('Search request aborted (timeout).', err);
      if (resultsContainer) resultsContainer.innerHTML = `<p style="text-align:center;color:red">Error: Search timed out. Try again.</p>`;
    } else {
      console.error('Search Proxy Error:', err);
      if (resultsContainer) resultsContainer.innerHTML = `<p style="text-align:center;color:red">Error: Could not complete search. (${escapeHtml(err.message || 'network')})</p>`;
    }
  }
}


/* =========================
   RENDER RESULTS
   ========================= */

function renderResults(results) {
  if (!results || results.length === 0) {
    if (resultsContainer) resultsContainer.innerHTML = '<p style="text-align: center;">No movies found.</p>';
    return;
  }

  const html = results.map(movie => {
    const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : '';
    const titleEsc = escapeHtml(movie.title || movie.name || 'Untitled');
    const overviewEsc = escapeHtml(movie.overview || '');
    const vote = (typeof movie.vote_average !== 'undefined' && movie.vote_average !== null) ? movie.vote_average.toFixed(1) : '';

    return `
      <article class="movie-card" data-movie-id="${movie.id}">
        <div class="poster">
          ${ posterUrl
            ? `<img loading="lazy" src="${posterUrl}" alt="${titleEsc} poster" onerror="this.onerror=null;this.src='https://via.placeholder.com/500x750?text=No+Poster'">`
            : `<div class="placeholder">No Image</div>`
          }

          ${ vote ? `<div class="rating-badge"><i class="fas fa-star"></i> ${vote}</div>` : '' }

          <div class="play-badge" title="Preview">
            <i class="fas fa-play"></i>
          </div>
        </div>

        <div class="movie-info">
          <h4 title="${titleEsc}">${titleEsc}</h4>

          <div class="meta">
            <span class="small muted">${movie.release_date ? (movie.release_date.slice(0,4)) : 'N/A'}</span>
            <span class="small muted">•</span>
            <span class="small muted">TMDB ${vote || '-'}</span>
          </div>

          <p class="muted small">${overviewEsc}</p>

          <div class="actions">
            <button type="button"
                    class="btn watchlist-btn"
                    data-tmdb-id="${movie.id}"
                    data-title="${escapeHtml(movie.title || movie.name || '')}"
                    data-poster-path="${movie.poster_path || ''}"
                    data-release-date="${movie.release_date || ''}">
              <i class="fas fa-plus"></i> <span class="btn-text">Add to Watchlist</span>
            </button>

            <a href="https://www.themoviedb.org/movie/${movie.id}" target="_blank" rel="noopener" class="btn ghost">
              <i class="fas fa-info-circle"></i> Details
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  if (resultsContainer) resultsContainer.innerHTML = `<div class="movie-results-grid">${html}</div>`;

  // re-attach handlers for watchlist buttons rendered here
  attachWatchlistButtons();
}


/* =========================
   RENDER WATCHLIST (watchlist page)
   ========================= */

function renderWatchlist(watchlistItems) {
  const container = document.getElementById('watchlist-container') || resultsContainer;
  if (!container) return;

  if (!watchlistItems || watchlistItems.length === 0) {
    container.innerHTML = '<p style="text-align:center">Your watchlist is empty.</p>';
    return;
  }

  const html = watchlistItems.map(item => {
    const posterUrl = item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';
    const titleEsc = escapeHtml(item.title || item.name || 'Untitled');
    const overviewEsc = escapeHtml(item.overview || '');

    // show rate button only if watched === true
    const rateButtonHtml = item.watched
      ? `<button type="button" class="rate-btn" data-tmdb-id="${item.tmdb_id}" data-title="${titleEsc}">
           <i class="fas fa-star"></i> Rate
         </button>`
      : `<button type="button" class="mark-watched-btn" data-tmdb-id="${item.tmdb_id}">
           <i class="fas fa-check"></i> Mark as Watched
         </button>`;

    return `
      <div class="watchlist-item-card" data-watchlist-id="${item.id || ''}" data-tmdb-id="${item.tmdb_id}">
        <img src="${posterUrl}" alt="${titleEsc} Poster" onerror="this.onerror=null;this.src='https://via.placeholder.com/500x750?text=No+Poster'">
        <div class="movie-info">
          <h4>${titleEsc}</h4>
          <p class="small muted">Added on: ${escapeHtml(item.added_date || '')}</p>
          <div class="movie-actions">
            <button type="button" class="remove-from-watchlist-btn" data-tmdb-id="${item.tmdb_id}">
              <i class="fas fa-trash"></i> Remove
            </button>
            ${rateButtonHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="watchlist-grid">${html}</div>`;

  // Attach handlers
  attachWatchlistButtons();
  attachRateButtons();
  attachMarkWatchedButtons();
}

/* =========================
   WATCHLIST: add/remove
   ========================= */

// replace existing handleWatchlistToggle with this version
async function handleWatchlistToggle(btn, desiredAction = null) {
  if (!btn) return;
  const tmdbId = btn.dataset.tmdbId || btn.getAttribute('data-tmdb-id');
  const title = btn.dataset.title || '';
  const posterPath = btn.dataset.posterPath || btn.getAttribute('data-poster-path') || '';
  const releaseDate = btn.dataset.releaseDate || btn.getAttribute('data-release-date') || '';

  const action = desiredAction || (btn.classList.contains('in-watchlist') ? 'remove' : 'add');

  const url = getMetaUrl('toggle-watchlist-url', '/api/watchlist/toggle/');

  if (!tmdbId) {
    console.error('Missing tmdb id on button', btn);
    alert('Internal error: missing movie id');
    return;
  }

  // UI elements we will update
  const textEl = btn.querySelector('.btn-text');
  const fallbackTextEl = btn; // used if .btn-text not found
  const setText = (s) => {
    if (textEl) textEl.textContent = s;
    else fallbackTextEl.textContent = s;
  };

  // give immediate feedback
  btn.disabled = true;
  setText(action === 'add' ? 'Adding...' : 'Removing...');

  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        tmdb_id: tmdbId,
        title: title,
        poster_path: posterPath,
        release_date: releaseDate,
        action: action
      })
    });

    // If server redirected (login) -> go to login
    if (res.redirected || res.status === 302) {
      window.location.href = '/login/?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (res.status === 401) {
      alert('Please login to manage your watchlist.');
      return;
    }

    // Parse response robustly depending on content-type
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch (err) {
        console.warn('JSON parse failed:', err);
        const t = await res.text();
        try { data = JSON.parse(t); } catch (e) { data = { raw: t }; }
      }
    } else {
      // not JSON — try text, then attempt JSON.parse
      const t = await res.text();
      try { data = JSON.parse(t); } catch (e) { data = { raw: t }; }
    }

    // debug
    console.debug('Watchlist toggle response', { status: res.status, ok: res.ok, data });

    if (!res.ok) {
      // choose a reasonable message to show
      const msg = (data && (data.message || data.error)) || `Server error (${res.status})`;
      alert(msg);
      // restore button label to original 'Add to Watchlist' state
      setText('Add to Watchlist');
      return;
    }

    // Success handling: prefer explicit data.status === 'success'
    if (data && (data.status === 'success' || data.status === true)) {
      if (action === 'add') {
        btn.classList.add('in-watchlist');
        setText('In Watchlist');
      } else {
        // removed
        btn.classList.remove('in-watchlist');
        // if on watchlist page remove the card element
        const card = btn.closest('.watchlist-item-card') || btn.closest('.movie-card');
        if (card && window.location.pathname.includes('watchlist')) {
          card.remove();
        } else {
          setText('Add to Watchlist');
        }
      }
      // optional: small success toast via console
      console.info(data.message || 'Watchlist updated');
    } else {
      // server responded OK but didn't return expected payload
      console.warn('Unexpected payload from watchlist toggle', data);
      const msg = (data && (data.message || data.error)) || 'Could not update watchlist.';
      alert(msg);
      setText(action === 'add' ? 'Add to Watchlist' : 'Remove from Watchlist');
    }

  } catch (err) {
    console.error('Network error toggling watchlist', err);
    alert('Network error. Try again.');
    // restore fallback
    setText(action === 'add' ? 'Add to Watchlist' : 'Remove from Watchlist');
  } finally {
    btn.disabled = false;
  }
}


function attachWatchlistButtons() {
  // add-to-watchlist buttons (both search and watchlist page)
  document.querySelectorAll('.watchlist-btn').forEach(btn => {
    // defensive cleanup
    btn.removeAttribute('onclick');
    btn.removeEventListener('click', watchlistBtnClickHandler);
    btn.addEventListener('click', watchlistBtnClickHandler);
  });

  // remove buttons on watchlist cards
  document.querySelectorAll('.remove-from-watchlist-btn').forEach(btn => {
    btn.removeEventListener('click', removeBtnHandler);
    btn.addEventListener('click', removeBtnHandler);
  });
}

function watchlistBtnClickHandler(e) {
  const btn = e.currentTarget;
  handleWatchlistToggle(btn);
}

function removeBtnHandler(e) {
  const btn = e.currentTarget;
  handleWatchlistToggle(btn, 'remove');
}

/* =========================
   MARK AS WATCHED -> then Rate
   ========================= */
function attachMarkWatchedButtons() {
  document.querySelectorAll('.mark-watched-btn').forEach(btn => {
    // remove old listener if present
    try { btn.removeEventListener('click', markWatchedHandler); } catch(e) {}
    btn.addEventListener('click', markWatchedHandler);
  });
}


async function markWatchedHandler(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  if (!btn) return console.warn('markWatchedHandler: no button');

  const tmdbId = btn.dataset.tmdbId || btn.getAttribute('data-tmdb-id');
  const title = btn.dataset.title || btn.getAttribute('data-title') || '';

  if (!tmdbId) {
    console.error('markWatchedHandler: missing tmdb id on button', btn);
    return;
  }

  // UX: disable button & show spinner
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  const url = getMetaUrl('toggle-watchlist-url', '/api/watchlist/toggle/');

  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (function(){ const m = document.cookie.match('(^|;)\\s*' + 'csrftoken' + '\\s*=\\s*([^;]+)'); return m? m.pop() : ''; })()
      },
      body: JSON.stringify({
        tmdb_id: tmdbId,
        title: title,
        action: 'mark_watched'
      })
    });

    // Debug logs
    console.debug('markWatchedHandler: fetch finished', {url, status: res.status});

    if (res.redirected || res.status === 302) {
      // Not authenticated
      window.location.href = '/login/?next=' + encodeURIComponent(window.location.pathname);
      return;
    }

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch(e) { data = null; }

    if (!res.ok) {
      console.error('markWatchedHandler: server error', res.status, text);
      alert((data && (data.message || data.error)) || `Server error (${res.status})`);
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      return;
    }

    // Success — update UI: replace mark-watched button with Watched + Rate
    const card = btn.closest('.watchlist-item-card');
    if (!card) {
      // Fallback: just change the button text
      btn.innerHTML = '<i class="fas fa-check-circle"></i> Watched';
      btn.disabled = true;
    } else {
      const watchActions = card.querySelector('.watch-actions') || btn.parentElement;
      if (watchActions) {
        // create watched label and rate button
        const watchedSpan = document.createElement('span');
        watchedSpan.className = 'watched-status';
        watchedSpan.innerHTML = '<i class="fas fa-check-circle"></i> Watched';

        const rateBtn = document.createElement('button');
        rateBtn.type = 'button';
        rateBtn.className = 'rate-btn';
        rateBtn.dataset.tmdbId = tmdbId;
        rateBtn.dataset.title = title || (card.querySelector('h3')?.textContent || '');
        rateBtn.innerHTML = '<i class="fas fa-star"></i> Rate';

        // replace the old action area with new nodes (or append)
        watchActions.innerHTML = ''; // clear current actions
        watchActions.appendChild(watchedSpan);
        watchActions.appendChild(rateBtn);

        // Attach rate button handler
        rateBtn.addEventListener('click', rateBtnClickHandler);
      }
    }

  } catch (err) {
    console.error('markWatchedHandler: network error', err);
    alert('Network error. Try again.');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

/* =========================
   RATING modal & submission
   ========================= */

function attachRateButtons() {
  document.querySelectorAll('.rate-btn').forEach(btn => {
    btn.removeEventListener('click', rateBtnClickHandler);
    btn.addEventListener('click', rateBtnClickHandler);
  });
}

function rateBtnClickHandler(e) {
  const btn = e.currentTarget;
  showRatingModal(btn);
}

function showRatingModal(button) {
  const title = button.dataset.title || 'Movie';
  currentMovieId = button.dataset.tmdbId || null;

  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.textContent = `Rate ${title}`;

  selectedRating = 0;
  renderStars();

  const modal = document.getElementById('ratingModal');
  if (modal) modal.style.display = 'flex';;
}

function closeRatingModal() {
  const modal = document.getElementById('ratingModal');
  if (modal) modal.style.display = 'none';
  currentMovieId = null;
  selectedRating = 0;
}

/* ===== Improved star UI for rating modal ===== */

function renderStars() {
  const starContainer = document.getElementById('star-rating');
  if (!starContainer) return;

  starContainer.innerHTML = ''; // clear old stars

  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star-btn';
    btn.innerText = '★'; // Unicode star (works without FA)
    btn.dataset.rating = i;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', (i === selectedRating).toString());
    btn.setAttribute('aria-label', `${i} star${i>1 ? 's' : ''}`);
    btn.setAttribute('tabindex', i === 1 ? '0' : '-1'); // only first star tabbable by default

    if (i <= selectedRating) btn.classList.add('active');
    else btn.classList.remove('active');

    // mouse click
    btn.addEventListener('click', (ev) => {
      selectedRating = parseInt(btn.dataset.rating);
      updateStarUI();
    });

    // keyboard: Enter/Space to select; ArrowLeft/ArrowRight to navigate
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectedRating = parseInt(btn.dataset.rating);
        updateStarUI();
        return;
      }
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = Math.min(5, parseInt(btn.dataset.rating) + 1);
        const nextBtn = starContainer.querySelector(`button[data-rating="${next}"]`);
        if (nextBtn) {
          nextBtn.focus();
        }
        return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        const prev = Math.max(1, parseInt(btn.dataset.rating) - 1);
        const prevBtn = starContainer.querySelector(`button[data-rating="${prev}"]`);
        if (prevBtn) {
          prevBtn.focus();
        }
        return;
      }
    });

    // visual hover preview (optional): highlight on mouseover
    btn.addEventListener('mouseover', () => {
      const r = parseInt(btn.dataset.rating);
      highlightStars(r);
    });
    btn.addEventListener('mouseout', () => {
      updateStarUI();
    });

    starContainer.appendChild(btn);
  }
}

// helper: update star buttons to reflect selectedRating
function updateStarUI() {
  const starContainer = document.getElementById('star-rating');
  if (!starContainer) return;
  const buttons = starContainer.querySelectorAll('button.star-btn');
  buttons.forEach(b => {
    const r = parseInt(b.dataset.rating);
    const active = r <= selectedRating;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', active ? 'true' : 'false');
    // make focused star tabbable
    b.setAttribute('tabindex', r === (selectedRating || 1) ? '0' : '-1');
  });
}

// helper: highlight preview (on hover)
function highlightStars(ratingToHighlight) {
  const starContainer = document.getElementById('star-rating');
  if (!starContainer) return;
  starContainer.querySelectorAll('button.star-btn').forEach(b => {
    const r = parseInt(b.dataset.rating);
    b.classList.toggle('active', r <= ratingToHighlight);
  });
}

/* Hook up the modal close/cancel and ensure renderStars() is called when opened */
document.addEventListener('click', function (e) {
  // close button
  if (e.target && e.target.id === 'closeRatingModalBtn') {
    closeRatingModal();
  }
  if (e.target && e.target.id === 'cancelRatingBtn') {
    closeRatingModal();
  }
});

// When you open modal via showRatingModal(), call renderStars() — your showRatingModal does this already.
// But ensure it also focuses the first star for keyboard users:
function showRatingModal(button) {
  const title = button?.dataset?.title || 'Movie';
  currentMovieId = button?.dataset?.tmdbId || null;

  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.textContent = `Rate ${title}`;

  // reset selection and render
  selectedRating = 0;
  renderStars();

  const modal = document.getElementById('ratingModal');
  if (modal) {
    modal.style.display = 'block';
    // focus the first star for keyboard navigation
    const firstStar = modal.querySelector('#star-rating button.star-btn');
    if (firstStar) firstStar.focus();
  }
}

// submit handler uses your existing submitRating logic (currentMovieId and selectedRating are used)
document.getElementById('submitRatingBtn')?.addEventListener('click', async function () {
  if (!currentMovieId || selectedRating === 0) {
    alert('Please select a rating (1-5).');
    return;
  }
  // call existing submit function (submitRatingViaApi or your endpoint)
  this.disabled = true;
  const result = await submitRatingViaApi(currentMovieId, selectedRating);
  this.disabled = false;
  if (!result.ok) {
    alert('An error occurred during rating submission: ' + (result.message || 'Unknown'));
    return;
  }

  closeRatingModal();
  if (window.location.pathname.includes('watchlist')) window.location.reload();
});


async function submitRatingViaApi(tmdb_id, rating) {
  const url = getMetaUrl('rating-submit-url', '/api/rating/submit/');
  if (!tmdb_id) {
    return { ok: false, message: 'No movie selected' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
        'Accept': 'application/json'
      },
      body: JSON.stringify({ tmdb_id: tmdb_id, rating: rating })
    });

    if (res.redirected || res.status === 302) {
      window.location.href = '/login/?next=' + encodeURIComponent(window.location.pathname);
      return { ok: false, message: 'login_required' };
    }

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* ignore */ }

    if (!res.ok) {
      console.error('Rating API error', res.status, text);
      return { ok: false, message: data?.message || `Server returned ${res.status}` };
    }
    return { ok: true, data: data };
  } catch (err) {
    console.error('Network error submitting rating', err);
    return { ok: false, message: err.message || 'network_error' };
  }
}

// single rating submit handler
document.getElementById('submitRatingBtn')?.addEventListener('click', async function () {
  if (!currentMovieId || !selectedRating) {
    alert('Please select a rating (1-5).');
    return;
  }
  const btn = this;
  btn.disabled = true;
  const result = await submitRatingViaApi(currentMovieId, selectedRating);
  btn.disabled = false;

  if (!result.ok) {
    message.error('An error occurred during rating submission: ' + (result.message || 'Unknown'));
    return;
  }

  const message = result.data?.message || 'Rating saved';
  closeRatingModal();

  if (window.location.pathname.includes('watchlist')) {
    window.location.reload();
  }
});

/* =========================
   PROFILE PICTURE UPLOAD
   ========================= */

document.addEventListener('DOMContentLoaded', function () {
  // initialize star UI (if modal exists)
  renderStars();

  // Profile Upload: look for these IDs (adjust if your template uses different IDs)
  const uploadButton = document.getElementById('choose-photo-label');
  const fileInput = document.getElementById('id_image') || document.getElementById('profile-image-input');
  const profileForm = document.getElementById('profile-pic-form') || document.getElementById('profile-image-form');

  if (uploadButton && fileInput && profileForm) {
    console.log("DEBUG: Profile upload elements found. Attaching listeners.");

    uploadButton.addEventListener('click', function (ev) {
      ev.preventDefault();
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length > 0) {
        const label = uploadButton;
        if (label) {
          label.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        }
        profileForm.submit();
      }
    });
  }

  // Attach watchlist & rate handlers on initial load (for server-rendered items)
  attachWatchlistButtons();
  attachRateButtons();
  attachMarkWatchedButtons();
});


document.addEventListener('DOMContentLoaded', function() {
        // Select all alert messages
        const alerts = document.querySelectorAll('.alert');
        
        alerts.forEach(function(alert) {
            // Set a timeout for 5 seconds (5000 milliseconds)
            setTimeout(function() {
                // Add the fade-out class to trigger the CSS animation
                alert.classList.add('fade-out');
                
                // Wait for the transition to finish (0.5s) before removing from DOM
                setTimeout(function() {
                    alert.remove();
                }, 300); 
            }, 3000);
        });
    });
