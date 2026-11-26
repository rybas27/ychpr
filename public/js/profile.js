import {
    $,
    api,
    authModal,
    esc,
    handle,
    initSession,
    me,
    modal,
    setUser,
    titleUrl,
    toast,
} from './common.js';

let profileData;
let activeTab = 'favorite';

async function renderProfile() {
    const d = await api('/profile');
    profileData = d;

    $('#profile-avatar').src = d.user.avatar || '/img/iconavatar.jpg';
    $('#profile-name').textContent = d.user.name;
    $('#profile-email').textContent = d.user.email;
    Object.entries({ ...d.lists, reviews: d.reviews }).forEach(
        ([key, items]) => {
            $(`[data-count="${key}"]`).textContent = `(${items.length})`;
        },
    );
    $('.profile-wrap').classList.remove('hidden');
    $('#profile-status').classList.add('hidden');

    document
        .querySelectorAll('[data-tab]')
        .forEach((b) => (b.onclick = () => drawProfileTab(b.dataset.tab)));
    drawProfileTab(activeTab);
    $('#edit-profile').onclick = editProfile;
    $('#delete-account').onclick = handle(async () => {
        if (
            confirm(
                'Удалить аккаунт и все связанные данные без возможности восстановления?',
            )
        ) {
            await api('/account', { method: 'DELETE' });
            setUser(null);
            location.assign('/');
        }
    });
}

function drawProfileTab(tab) {
    activeTab = tab;
    const c = $('#profile-content');
    document.querySelectorAll('[data-tab]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.tab === tab);
    });

    if (tab === 'reviews') {
        c.innerHTML = profileData.reviews.length
            ? profileData.reviews
                  .map(
                      (r) =>
                          `<div class="admin-row"><div><b>${esc(r.title_name)}</b><p class="muted">Оценка ${r.rating}/10 · ${r.approved ? 'Опубликован' : 'На модерации'}</p><p>${esc(r.body)}</p></div><button class="small-btn danger" data-del-review="${r.id}">УДАЛИТЬ</button></div>`,
                  )
                  .join('')
            : '<p>Вы ещё не оставляли отзывов.</p>';
        document.querySelectorAll('[data-del-review]').forEach(
            (b) =>
                (b.onclick = handle(async () => {
                    await api('/reviews/' + b.dataset.delReview, {
                        method: 'DELETE',
                    });
                    await renderProfile();
                })),
        );
        return;
    }

    const items = profileData.lists[tab];
    c.innerHTML = items.length
        ? `<div class="profile-list">${items.map((t) => `<div class="mini-card"><b>${esc(t.name)}</b><p class="muted">${t.year} · ★ ${t.rating}</p><a class="small-btn" href="${titleUrl(t.id)}">ОТКРЫТЬ</a><button class="small-btn danger" data-remove="${t.id}" data-kind="${tab}">УДАЛИТЬ</button></div>`).join('')}</div>`
        : '<p class="muted">Здесь пока пусто. Добавляй интересные истории из каталога.</p>';

    document.querySelectorAll('[data-remove]').forEach(
        (b) =>
            (b.onclick = handle(async () => {
                await api('/lists/' + b.dataset.kind + '/' + b.dataset.remove, {
                    method: 'DELETE',
                });
                await renderProfile();
            })),
    );
}

function editProfile() {
    modal(
        'НАСТРОЙКИ ПРОФИЛЯ',
        `<form id="profile-form" enctype="multipart/form-data"><div class="field"><label>Имя</label><input name="name" value="${esc(profileData.user.name)}" required minlength="2"></div><div class="field"><label>Фото профиля</label><input name="avatar" type="file" accept="image/*"></div><button class="form-submit">СОХРАНИТЬ</button></form>`,
    );
    $('#profile-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const u = await api('/profile', {
                method: 'PATCH',
                body: new FormData(e.target),
            });
            setUser(u);
            $('#modal-root').innerHTML = '';
            await renderProfile();
        } catch (err) {
            toast(err.message);
        }
    };
}

async function load() {
    const status = $('#profile-status');
    $('.profile-wrap').classList.add('hidden');
    status.classList.remove('hidden');
    if (!me) {
        status.textContent = 'Войдите, чтобы открыть профиль.';
        authModal('login', load);
        return;
    }
    try {
        await renderProfile();
    } catch (error) {
        status.textContent = error.message;
    }
}

initSession({ onLogin: load, onLogout: () => location.assign('/') }).then(load);
