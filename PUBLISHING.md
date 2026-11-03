# Публикация Errand

Порядок: GitHub → Chrome Web Store → Firefox Add-ons → Edge Add-ons. Opera и Safari потом.

## 0. Перед первой загрузкой

1. Создать публичный репозиторий `errand-for-youtube` на GitHub и запушить код.
   - Описание: `Browser extension that hides YouTube Shorts, the home feed and recommendations, and asks what you came for. Free, open source, no tracking.`
   - Topics: `youtube`, `browser-extension`, `chrome-extension`, `firefox-addon`, `webextension`, `manifest-v3`, `youtube-shorts`, `distraction-free`, `digital-wellbeing`, `focus`, `productivity`, `privacy`
   - Settings → Pages → Deploy from branch → `main` / `/docs`. Сайт появится на `https://<user>.github.io/errand-for-youtube/`.
2. Заменить заглушки во всех файлах (`grep -rn "{{" --exclude-dir=dist --exclude-dir=notes .`):
   - `https://github.com/SomeStay07/errand-for-youtube`: ссылка на репозиторий
   - `https://somestay07.github.io/errand-for-youtube`: адрес GitHub Pages без слеша в конце
   - `{{CONTACT_EMAIL}}`: почта для вопросов
   - `https://github.com/SomeStay07/errand-for-youtube`, `https://github.com/SomeStay07/errand-for-youtube`, `https://github.com/SomeStay07/errand-for-youtube`: после публикации в магазинах; до этого можно оставить ссылку на GitHub
3. `npm test && npm run build` → zip-файлы в `dist/`.

## 1. Chrome Web Store

1. Аккаунт разработчика: https://chrome.google.com/webstore/devconsole (разовый взнос $5, подтверждение личности).
2. New item → загрузить `dist/errand-chrome-<версия>.zip`.
3. Store listing:
   - Описание: из `store/listing/en.md` (то, что ниже строки «Description»). Для других языков переключить язык в выпадающем списке и вставить `ru.md`, `es.md`, `pt_BR.md`, `de.md`. Название и краткое описание подтягиваются из `_locales` автоматически.
   - Category: Productivity / Workflow & Planning.
   - Иконка 128×128: `icons/icon-128.png`.
   - Скриншоты 1280×800: `store/images/<язык>/screenshot-*.png`.
   - Small promo tile 440×280: `store/images/<язык>/promo-small-440x280.png` (без неё листинг ранжируется ниже).
   - Marquee 1400×560: `store/images/<язык>/promo-marquee-1400x560.png`.
4. Privacy practices (готовые ответы):
   - **Single purpose:** Errand reduces distraction on youtube.com. It hides Shorts, the home feed, recommendations and end-screen suggestions, replaces the home page with a "What are you here for?" search box, and offers to close the tab when a video ends. All features act only on www.youtube.com pages.
   - **storage:** Saves the user's settings, the optional goal typed on the home page (deleted after 3 hours), weekly counts of opened videos and a short local log of filters that stopped working, in local extension storage. Nothing is transmitted.
   - **Host permission (https://www.youtube.com/\*):** The content script and CSS must run on YouTube pages to hide Shorts, the feed, recommendations and comments before the page draws, to add the extension's own buttons (show recommendations, close tab), and to check that its filters still match YouTube's layout. It runs on no other site; embeds are excluded.
   - **Remote code:** No, I am not using remote code.
   - **Data usage:** не отмечать ни одной категории.
   - Поставить все три галочки сертификации.
   - **Privacy policy URL:** `https://github.com/SomeStay07/errand-for-youtube/blob/main/PRIVACY.md` (или страница на сайте).
5. Distribution: Public, все регионы. Submit for review (обычно от нескольких часов до нескольких дней).

## 2. Firefox Add-ons (AMO)

1. https://addons.mozilla.org/developers/ → Submit a New Add-on → On this site.
2. Загрузить `dist/errand-firefox-<версия>.zip`. Название для Firefox короткое (`extNameShort`, до 45 символов) — сборка подставляет его сама.
3. Исходный код загружать не нужно: код не минифицирован.
4. Описание: те же тексты, но без строки с пометкой «[Chrome Web Store only]».
5. Категория: Privacy & Security или Other; теги: youtube, shorts, distraction, focus.
6. Privacy policy: вставить текст из `PRIVACY.md`.

## 3. Edge Add-ons

1. https://partner.microsoft.com/dashboard/microsoftedge → регистрация бесплатная.
2. Загрузить `dist/errand-edge-<версия>.zip` (короткое название подставлено).
3. Описания — как для Firefox (без строки про Chrome Web Store). Логотип 300×300 можно сделать из `store/images/icon-1024.png`.
4. Проверка обычно занимает до 7 рабочих дней.

## 4. Позже

- **Opera:** `dist/errand-opera-<версия>.zip` на https://addons.opera.com/developer/. Проверка медленная.
- **Safari (macOS/iOS):** нужен Apple Developer ($99/год) и `xcrun safari-web-extension-converter dist/chrome`. Название в App Store до 30 символов: «Errand for YouTube». Для iPhone нужна поддержка m.youtube.com — это v0.2.

## После публикации

- Подставить ссылки магазинов в README, `docs/index.html`, `docs/ru/index.html` и запушить.
- AlternativeTo: добавить как альтернативу Unhook, DF Tube, Remove YouTube Suggestions, BlockTube, UnTrap (текст в `notes/roadmap.md` и отчёте SEO).
- Каждое обновление: поднять `version` в `manifest.json`, `npm test && npm run build`, загрузить новые zip во все магазины.
