import { $, api, esc, initSession, titleUrl } from './common.js';

const filters = $('#catalog-filters');
const grid = $('#catalog-grid');
const strip = $('#recommend-strip');
let timer;
let request;
let initialTitles;
let recommendRequest;

function poster(title, placeholder) {
    return title.image
        ? `<img src="${esc(title.image)}" alt="" loading="lazy" decoding="async">`
        : placeholder;
}

function renderRecommendations(titles) {
    strip.innerHTML = titles.length
        ? titles
              .map(
                  (title) => `
            <a class="strip-card" href="${titleUrl(title.id)}">
                <span class="film-perf"></span>
                ${poster(title, '<div class="strip-poster-placeholder">CV</div>')}
                <b>${esc(title.name)}</b>
                <small>${title.year} · ${esc(title.age_rating || '0+')} · ★ ${Number(title.rating).toFixed(1)}</small>
            </a>`,
              )
              .join('')
        : '<div class="strip-empty">Здесь появятся фильмы из каталога</div>';
}

function renderCatalog(titles) {
    grid.innerHTML = titles.length
        ? titles
              .map((title, index) => {
                  const duration =
                      title.type === 'Сериал'
                          ? `${title.season_count || 0} сез. · ${title.episode_count || 0} сер. · `
                          : title.duration
                            ? `${title.duration} мин. · `
                            : '';
                  return `
                <a class="movie-card" href="${titleUrl(title.id)}" style="--tilt:${index % 2 ? '.5' : '-.5'}deg">
                    <div class="poster">
                        ${poster(title, '<div class="poster-placeholder">CINE<br>VIBE</div>')}
                        <span class="type-tag">${esc(title.type)}</span>
                    </div>
                    <div class="card-info">
                        <h3>${esc(title.name)}</h3>
                        <p class="muted">${title.year} · ${esc(title.genres)}</p>
                        <p class="muted">${esc(title.country || 'Страна не указана')}${title.publisher ? ' · ' + esc(title.publisher) : ''}</p>
                        <p class="muted">${duration}${esc(title.age_rating || '0+')}</p>
                        <span class="rating">★ ${Number(title.rating).toFixed(1)}</span>
                        <span class="muted">${title.review_count} отзывов</span>
                    </div>
                </a>`;
              })
              .join('')
        : '<div class="empty-state">Фильмы и сериалы не найдены.</div>';
}

async function loadRecommendations() {
    recommendRequest?.abort();
    recommendRequest = new AbortController();
    try {
        const titles = await api('/titles?excludeWatched=1', {
            signal: recommendRequest.signal,
        });
        renderRecommendations(titles);
    } catch (error) {
        if (error.name !== 'AbortError') {
            strip.textContent = 'Не удалось загрузить рекомендации.';
        }
    }
}

function loadInitialTitles() {
    if (!initialTitles) {
        initialTitles = api('/titles')
            .then((titles) => titles)
            .catch((error) => {
                initialTitles = null;
                throw error;
            });
    }
    return initialTitles;
}

async function loadTitles(controller) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(filters)) {
        if (
            value.trim() &&
            !(key === 'minRating' && value === '0') &&
            !(key === 'sort' && value === 'new')
        ) {
            params.set(key, value.trim());
        }
    }
    try {
        const titles = params.size
            ? await api('/titles?' + params, { signal: controller.signal })
            : await loadInitialTitles();
        if (!controller.signal.aborted) renderCatalog(titles);
    } catch (error) {
        if (!controller.signal.aborted) grid.textContent = error.message;
    }
}

function scheduleSearch(delay = 0) {
    clearTimeout(timer);
    request?.abort();
    request = new AbortController();
    const controller = request;
    timer = setTimeout(() => loadTitles(controller), delay);
}

filters.addEventListener('input', (event) =>
    scheduleSearch(event.target.matches('select') ? 0 : 280),
);
filters.addEventListener('submit', (event) => {
    event.preventDefault();
    scheduleSearch();
});
filters.addEventListener('reset', () => scheduleSearch());
$('#film-left').onclick = () =>
    strip.scrollBy({ left: -420, behavior: 'smooth' });
$('#film-right').onclick = () =>
    strip.scrollBy({ left: 420, behavior: 'smooth' });

initSession({
    onLogin: loadRecommendations,
    onLogout: loadRecommendations,
}).then(loadRecommendations);

window.addEventListener('pageshow', (event) => {
    if (event.persisted) loadRecommendations();
});

scheduleSearch();