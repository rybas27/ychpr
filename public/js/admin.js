import {
    $,
    api,
    esc,
    handle,
    initSession,
    me,
    modal,
    toast,
} from './common.js';

function titleEditor(t) {
    modal(
        'РЕДАКТИРОВАТЬ ФИЛЬМ / СЕРИАЛ',
        `<form id="edit-title"><div class="field"><label>Тип</label><select name="type"><option ${t.type === 'Фильм' ? 'selected' : ''}>Фильм</option><option ${t.type === 'Сериал' ? 'selected' : ''}>Сериал</option></select></div><div class="field"><label>Название</label><input name="name" value="${esc(t.name)}" required></div><div class="field"><label>Год выпуска</label><input name="year" type="number" min="1888" max="2035" value="${t.year}" required></div><div class="field"><label>Длительность фильма / серии (минуты)</label><input name="duration" type="number" min="0" value="${t.duration || ''}"></div><div class="field serial-fields"><label>Количество сезонов</label><input name="season_count" type="number" min="1" value="${t.season_count || ''}"></div><div class="field serial-fields"><label>Количество серий (всего)</label><input name="episode_count" type="number" min="1" value="${t.episode_count || ''}"></div><div class="field"><label>Страна</label><input name="country" value="${esc(t.country || '')}" maxlength="100"></div><div class="field"><label>Издатель / студия</label><input name="publisher" value="${esc(t.publisher || '')}" maxlength="160"></div><div class="field"><label>Возрастное ограничение</label><select name="age_rating">${['0+', '6+', '12+', '16+', '18+'].map((x) => `<option ${x === (t.age_rating || '0+') ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>Жанры</label><input name="genres" value="${esc(t.genres)}" required></div><div class="field"><label>Актёры</label><input name="actors" value="${esc(t.actors)}" required></div><div class="field"><label>Режиссёры</label><input name="directors" value="${esc(t.directors)}" required></div><div class="field"><label>Описание</label><textarea name="description" required>${esc(t.description)}</textarea></div><div class="field"><label>Ссылка на постер / фото</label><input name="image" type="url" value="${esc(t.image || '')}" placeholder="https://example.com/poster.jpg" maxlength="500"></div><button class="form-submit">СОХРАНИТЬ ИЗМЕНЕНИЯ</button></form>`,
    );

    const editType = $('#edit-title [name=type]');
    const toggleEditSerial = () =>
        document
            .querySelectorAll('#edit-title .serial-fields')
            .forEach((x) => (x.hidden = editType.value !== 'Сериал'));
    editType.addEventListener('change', toggleEditSerial);
    toggleEditSerial();

    // Живое превью постера по ссылке
    const imageInput = $('#edit-title [name=image]');
    const preview = document.createElement('img');
    preview.className = 'poster-preview';
    preview.alt = '';
    preview.hidden = true;
    imageInput.after(preview);
    const syncPreview = () => {
        const v = imageInput.value.trim();
        preview.src = v;
        preview.hidden = !v;
    };
    imageInput.addEventListener('input', syncPreview);
    syncPreview();

    $('#edit-title').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = Object.fromEntries(new FormData(e.target));
            await api('/titles/' + t.id, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            $('#modal-root').innerHTML = '';
            toast('Изменения сохранены');
            await renderAdmin();
        } catch (err) {
            toast(err.message);
        }
    };
}

async function renderAdmin() {
    const [pending, titles] = await Promise.all([
        api('/admin/reviews'),
        api('/titles'),
    ]);

    $('#pending-count').textContent = pending.length;
    $('#pending-list').innerHTML = pending.length
        ? pending
              .map(
                  (r) =>
                      `<div class="admin-row"><div><b>${esc(r.title_name)}</b> — ${esc(r.user_name)}<p>★ ${r.rating}/10 ${r.spoiler ? ' · ⚠ СПОЙЛЕР' : ''}</p><p>${esc(r.body)}</p></div><div><button class="small-btn" data-approve="${r.id}">ОДОБРИТЬ</button> <button class="small-btn danger" data-reject="${r.id}">УДАЛИТЬ</button></div></div>`,
              )
              .join('')
        : '<p class="muted">Нет отзывов, ожидающих проверки.</p>';
    $('.admin-wrap').classList.remove('hidden');
    $('#admin-status').classList.add('hidden');

    const addType = $('#add-title [name=type]');
    const toggleAddSerial = () =>
        document
            .querySelectorAll('#add-title .serial-fields')
            .forEach((x) => (x.hidden = addType.value !== 'Сериал'));
    addType.onchange = toggleAddSerial;
    toggleAddSerial();
$('#add-title').onsubmit = async (e) => {
    e.preventDefault();
    try {
        const payload = Object.fromEntries(new FormData(e.target));
        await api('/titles', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        toast('Добавлено');
        e.target.reset();
        // снова применяем логику скрытия полей сериала
        toggleAddSerial();
        await renderAdmin();
    } catch (err) {
        toast(err.message);
    }
};

    document.querySelectorAll('[data-approve]').forEach(
        (b) =>
            (b.onclick = handle(async () => {
                await api('/admin/reviews/' + b.dataset.approve + '/approve', {
                    method: 'POST',
                });
                await renderAdmin();
            })),
    );
    document.querySelectorAll('[data-reject]').forEach(
        (b) =>
            (b.onclick = handle(async () => {
                await api('/admin/reviews/' + b.dataset.reject, {
                    method: 'DELETE',
                });
                await renderAdmin();
            })),
    );

    $('#admin-titles').innerHTML = titles.length
        ? titles
              .map(
                  (t) =>
                      `<div class="admin-row"><div><b>${esc(t.name)} (${t.year})</b><p class="muted">${t.type === 'Сериал' ? `${t.season_count} сез. · ${t.episode_count} сер.` : `${t.duration || '—'} мин.`} · ${esc(t.country || 'Страна не указана')} · ${esc(t.publisher || 'Издатель не указан')} · ${esc(t.age_rating || '0+')}</p></div><div><button class="small-btn" data-edit-title="${t.id}">ИЗМЕНИТЬ</button> <button class="small-btn danger" data-delete-title="${t.id}">УДАЛИТЬ</button></div></div>`,
              )
              .join('')
        : '<p class="muted">Каталог пуст.</p>';

    document.querySelectorAll('[data-edit-title]').forEach(
        (b) =>
            (b.onclick = handle(async () => {
                const { title: t } = await api(
                    '/titles/' + b.dataset.editTitle,
                );
                titleEditor(t);
            })),
    );
    document.querySelectorAll('[data-delete-title]').forEach(
        (b) =>
            (b.onclick = handle(async () => {
                if (confirm('Удалить запись и связанные отзывы?')) {
                    await api('/titles/' + b.dataset.deleteTitle, {
                        method: 'DELETE',
                    });
                    await renderAdmin();
                }
            })),
    );
}

async function load() {
    const status = $('#admin-status');
    $('.admin-wrap').classList.add('hidden');
    status.classList.remove('hidden');
    if (me?.role !== 'admin') {
        status.textContent = 'Доступ только для администратора.';
        return;
    }
    try {
        await renderAdmin();
    } catch (error) {
        status.textContent = error.message;
    }
}

initSession({ onLogin: load, onLogout: () => location.assign('/') }).then(load);
