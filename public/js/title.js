import { $, api, esc, initSession, me, modal, toast } from './common.js';

const id = new URLSearchParams(location.search).get('id');
let currentTitle;

async function renderTitle(id) {
    const { title: t, reviews, listTypes } = await api('/titles/' + id);
    document.title = t.name + ' — CINEVIBE';
    currentTitle = t;
    const isSeries = t.type === 'Сериал';
    const fields = {
        type: `${t.type} / ${t.year}`,
        name: t.name,
        rating: `★ ${Number(t.rating).toFixed(1)}`,
        'review-count': `${t.review_count} отзывов`,
        duration: t.duration ? `${t.duration} мин.` : 'Не указана',
        seasons: t.season_count || 0,
        episodes: t.episode_count || 0,
        country: t.country || 'Не указана',
        publisher: t.publisher || 'Не указан',
        age: t.age_rating || '0+',
        genres: t.genres,
        actors: t.actors,
        directors: t.directors,
        description: t.description,
    };
    for (const [key, value] of Object.entries(fields)) {
        $(`#title-${key}`).textContent = value;
    }
    if (t.image) $('#title-poster').src = t.image;
    else $('#title-poster').removeAttribute('src');
    $('#title-poster').classList.toggle('hidden', !t.image);
    $('#poster-placeholder').classList.toggle('hidden', !!t.image);
    $('#film-meta').classList.toggle('hidden', isSeries);
    $('#serial-meta').classList.toggle('hidden', !isSeries);
    $('#member-actions').classList.toggle('hidden', !me);
    $('#guest-actions').classList.toggle('hidden', !!me);

    $('#title-content').classList.remove('hidden');
    $('#review-area').classList.remove('hidden');
    $('#reviews-count').textContent = reviews.length;
    $('#title-status').classList.add('hidden');

    const listLabels = {
        favorite: ['♡ В избранное', '♥ В избранном'],
        watched: ['＋ Просмотрено', '✓ Просмотрено'],
        planned: ['＋ В планы', '✓ В планах'],
    };
    document.querySelectorAll('[data-list]').forEach((button) => {
        const type = button.dataset.list;
        const exists = listTypes.includes(type);
        button.textContent = listLabels[type][Number(exists)];
        button.setAttribute('aria-pressed', exists);
        button.classList.toggle('active', exists);
        button.onclick = async () => {
            button.disabled = true;
            try {
                await api(`/lists/${type}/${t.id}`, {
                    method: exists ? 'DELETE' : 'POST',
                });
                await renderTitle(id);
            } catch (error) {
                toast(error.message);
            } finally {
                button.disabled = false;
            }
        };
    });

    $('#write-review').onclick = reviewModal;
    $('#spoiler-filter').onchange = () => drawReviews(reviews);
    drawReviews(reviews);
}

function drawReviews(reviews) {
    const f = $('#spoiler-filter').value;
    const filtered = reviews.filter(
        (r) => f === 'all' || (f === 'safe' ? !r.spoiler : !!r.spoiler),
    );

    $('#reviews-list').innerHTML = filtered.length
        ? filtered
              .map(
                  (r) =>
                      `<article class="review"><div class="review-top"><b>${esc(r.name)}</b><span class="rating">★ ${r.rating}/10</span></div><p class="muted">${new Date(r.created_at + 'Z').toLocaleDateString('ru-RU')}</p>${r.spoiler ? `<button class="spoiler" data-spoiler="${r.id}">⚠ СПОЙЛЕР — показать отзыв</button><p class="spoiler-content" id="spoiler-${r.id}">${esc(r.body)}</p>` : `<p>${esc(r.body)}</p>`}${
                          me
                              ? `
            <div class="vote-row">
                <button class="vote-btn" data-vote="${r.id}" data-value="1" title="Нравится">
                    <img src="/img/iconlike.png" alt="like">
                    <span class="vote-count">${r.likes || 0}</span>
                </button>
                <button class="vote-btn" data-vote="${r.id}" data-value="-1" title="Не нравится">
                    <img src="/img/icondislike.png" alt="dislike">
                    <span class="vote-count">${r.dislikes || 0}</span>
                </button>
            </div>`
                              : ''
                      }</article>`,
              )
              .join('')
        : '<p class="muted">Пока нет отзывов в этой категории.</p>';

    document
        .querySelectorAll('[data-spoiler]')
        .forEach(
            (b) =>
                (b.onclick = () =>
                    $('#spoiler-' + b.dataset.spoiler).classList.toggle(
                        'show',
                    )),
        );
    document.querySelectorAll('[data-vote]').forEach(
        (b) =>
            (b.onclick = async () => {
                try {
                    await api('/reviews/' + b.dataset.vote + '/vote', {
                        method: 'POST',
                        body: JSON.stringify({ vote: Number(b.dataset.value) }),
                    });
                    await renderTitle(currentTitle.id);
                } catch (e) {
                    toast(e.message);
                }
            }),
    );
}

function reviewModal() {
    modal(
        'ТВОЁ МНЕНИЕ ВАЖНО',
        `<form id="review-form"><div class="field"><label>Оценка от 1 до 10</label><select name="rating">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i === 9 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div><div class="field"><label>Текст отзыва</label><textarea name="body" minlength="5" required placeholder="Что думаешь об этой истории?"></textarea></div><label><input type="checkbox" name="spoiler"> В отзыве есть спойлеры</label><p class="muted">Отзыв появится на сайте после проверки администратором.</p><button class="form-submit">ОТПРАВИТЬ НА МОДЕРАЦИЮ</button></form>`,
    );
    $('#review-form').onsubmit = async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        d.title_id = currentTitle.id;
        d.spoiler = !!e.target.elements.spoiler.checked;
        try {
            const r = await api('/reviews', {
                method: 'POST',
                body: JSON.stringify(d),
            });
            $('#modal-root').innerHTML = '';
            toast(r.message);
        } catch (err) {
            toast(err.message);
        }
    };
}

async function load() {
    try {
        if (!/^[1-9]\d*$/.test(id ?? ''))
            throw new Error('Карточка не найдена');
        await renderTitle(id);
    } catch (error) {
        $('#title-status').textContent = error.message;
        $('#title-status').classList.remove('hidden');
    }
}

initSession({ onLogin: load, onLogout: load }).then(load);
