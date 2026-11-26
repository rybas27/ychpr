export const $ = (s) => document.querySelector(s);
export let me = null;

export const esc = (s) =>
    String(s ?? '').replace(
        /[&<>"']/g,
        (c) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c],
    );

export async function api(url, opts = {}) {
    const res = await fetch('/api' + url, {
        ...opts,
        headers: {
            ...(typeof opts.body === 'string'
                ? { 'Content-Type': 'application/json' }
                : {}),
            ...(opts.headers || {}),
        },
    });
    let data = {};
    try {
        data = await res.json();
    } catch {}
    if (!res.ok) throw Error(data.error || 'Ошибка запроса');
    return data;
}

export function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

export function setUser(u) {
    me = u;
    document
        .querySelectorAll('.auth-only')
        .forEach((x) => x.classList.toggle('hidden', !u));
    document
        .querySelectorAll('.admin-only')
        .forEach((x) => x.classList.toggle('hidden', u?.role !== 'admin'));
    $('#login-open').classList.toggle('hidden', !!u);
    $('#register-open').classList.toggle('hidden', !!u);
    $('#logout').classList.toggle('hidden', !u);
}

export function modal(title, html) {
    $('#modal-root').innerHTML =
        `<div class="modal"><div class="modal-box"><button class="close" data-close>×</button><h2>${title}</h2>${html}</div></div>`;
    $('#modal-root').querySelector('[data-close]').onclick = () =>
        ($('#modal-root').innerHTML = '');
    $('#modal-root').querySelector('.modal').onclick = (e) => {
        if (e.target.classList.contains('modal'))
            $('#modal-root').innerHTML = '';
    };
}

export function authModal(kind, onLogin) {
    const reg = kind === 'register';
    modal(
        reg ? 'СОЗДАТЬ АККАУНТ' : 'С ВОЗВРАЩЕНИЕМ',
        `<form id="auth-form">
            <div class="auth-gif">
                <img
                    src="/img/${reg ? 'register' : 'register'}.gif"
                    alt=""
                    loading="lazy"
                    decoding="async"
                >
            </div>
            ${reg ? `<div class="field"><label>Имя</label><input name="name" required minlength="2"></div>` : ''}
            <div class="field"><label>Почта</label><input name="email" type="email" required></div>
            <div class="field"><label>Пароль</label><input name="password" type="password" minlength="8" required></div>
            ${reg ? `<div class="field"><label>Повторите пароль</label><input name="repeat" type="password" required></div>` : ''}
            <button class="form-submit">${reg ? 'ЗАРЕГИСТРИРОВАТЬСЯ' : 'ВОЙТИ'}</button>
        </form>`,
    );
    $('#auth-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const d = Object.fromEntries(new FormData(e.target));
            setUser(
                await api(reg ? '/register' : '/login', {
                    method: 'POST',
                    body: JSON.stringify(d),
                }),
            );
            $('#modal-root').innerHTML = '';
            toast('Вы вошли в CINEVIBE');
            await onLogin?.();
        } catch (err) {
            toast(err.message);
        }
    };
}

export const titleUrl = (id) =>
    '/pages/title.html?id=' + encodeURIComponent(id);

export function handle(action) {
    return async (...args) => {
        try {
            await action(...args);
        } catch (error) {
            toast(error.message);
        }
    };
}

export async function initSession({ onLogin, onLogout } = {}) {
    $('#login-open').onclick = () => authModal('login', onLogin);
    $('#register-open').onclick = () => authModal('register', onLogin);
    $('#logout').onclick = handle(async () => {
        await api('/logout', { method: 'POST' });
        setUser(null);
        toast('Вы вышли из аккаунта');
        await onLogout?.();
    });
    try {
        setUser(await api('/me'));
    } catch {
        setUser(null);
    }
}
