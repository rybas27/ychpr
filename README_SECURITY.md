# CINEVIBE — запуск и безопасность

## Запуск
1. Установите Node.js 24 или новее.
2. В папке проекта выполните `npm install`.
3. Скопируйте `.env.example` в `.env` и задайте `SESSION_SECRET` (случайная строка от 32 символов), `ADMIN_EMAIL` и `ADMIN_PASSWORD` (не менее 12 символов).
4. Запустите `npm start` (скрипт автоматически читает `.env` в Node.js 24+).

Первый администратор создаётся только при наличии обоих `ADMIN_EMAIL` и `ADMIN_PASSWORD`. Удалены публично известные значения по умолчанию.

## Роли
В БД у пользователя хранится поле `role`: строго `admin` или `user`.
Регистрация всегда создаёт `user`. Назначение роли доступно только из консоли сервера:

```bash
node server.js --grant-admin user@example.com
node server.js --revoke-admin user@example.com
```

Команда меняет роль существующего аккаунта. Не добавляйте назначение роли в клиентский HTML/JS и не принимайте `role` из формы регистрации. Проверка доступа выполняется серверным middleware для каждого защищённого API-эндпоинта; скрытая кнопка в интерфейсе не является защитой.

## Базовая защита, добавленная в проект
- Случайный секрет сессии в development; обязательный `SESSION_SECRET` в production.
- Сессионный cookie `HttpOnly`, `SameSite=Strict`, `Secure` в production, ограниченный срок.
- Регенерация сессии при регистрации и входе.
- Проверка same-origin для изменяющих запросов API.
- Ограничение частоты попыток входа/регистрации.
- Ограничения JSON/form body, безопасные HTTP-заголовки и CSP.
- Роль `admin/user` вместо логики авторизации на основе только клиентского флага.

## Важно перед публикацией
Это базовая защита, не полноценный аудит. Используйте HTTPS, настройте обратный прокси и доверие к нему корректно, регулярно обновляйте зависимости, делайте резервные копии SQLite, добавьте устойчивый rate limit (Redis/БД) для нескольких процессов и проверку содержимого загружаемых изображений по сигнатуре. При смене `SESSION_SECRET` все сессии станут недействительными.

## Страницы сайта

| Страница | HTML | JavaScript |
| --- | --- | --- |
| Каталог `/` | `public/index.html` | `public/js/catalog.js` |
| Карточка `/pages/title.html?id=…` | `public/pages/title.html` | `public/js/title.js` |
| Профиль `/pages/profile.html` | `public/pages/profile.html` | `public/js/profile.js` |
| Админ-панель `/pages/admin.html` | `public/pages/admin.html` | `public/js/admin.js` |

`public/js/common.js` содержит общие функции авторизации, работы с API и формами.
`public/style.css` подключён на всех страницах. Открывайте сайт через сервер по адресу
`http://localhost:3000`, чтобы работали API и сессии.

## Node.js 24.13.1

Проект рассчитан на Node.js `24.13.1` (Node 24.x). Установите именно эту версию и проверьте: `node --version`.

Для локального запуска используйте `NODE_ENV=development` в `.env`, чтобы браузер на `http://localhost:3000` мог получать cookie сессии. На опубликованном HTTPS-сайте переключите `NODE_ENV=production` и задайте уникальный `SESSION_SECRET` длиной не менее 32 символов.

Установка и запуск:

```bash
npm ci
npm start
```

Перед установкой убедитесь, что установлен Node.js 24.13.1 и npm, поставляемый с ним. `better-sqlite3` содержит нативный модуль; `npm ci` установит подходящий бинарник или соберёт его для вашей платформы.


## Node.js 24.13.1 на Windows: если npm падает на better-sqlite3 / node-gyp

`better-sqlite3` использует нативный SQLite-модуль. Обычно npm скачивает готовый бинарник; если скачать его не удалось, модуль собирается локально и требует Python и C++ build tools. Ошибка `Could not find any Python installation to use` означает, что это окружение сборки не настроено, а не ошибку страниц сайта.

1. Установите Python 3.12 x64 с https://www.python.org/downloads/windows/ и отметьте `Add python.exe to PATH`.
2. Установите Visual Studio Build Tools 2022: https://visualstudio.microsoft.com/visual-cpp-build-tools/ . В установщике выберите `Desktop development with C++` (MSVC и Windows SDK).
3. Закройте и заново откройте терминал. Проверьте `py -3 --version` и `python --version`.
4. В PowerShell из папки проекта выполните (укажите свой путь к Python, если команда `py` не работает):

```powershell
npm config set python "C:\Path\To\Python312\python.exe"
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm ci
npm start
```

Не удаляйте `package-lock.json`. Предупреждения `DEP0169`, `DEP0060` и `DEP0190` в вашем выводе — предупреждения устаревших API, а критическая ошибка именно отсутствие Python для node-gyp.
