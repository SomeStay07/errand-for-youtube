# Публикация Errand

Порядок: GitHub → Chrome Web Store → Firefox Add-ons → Edge Add-ons. Opera и Safari потом.

## 0. Перед первой загрузкой

1. Создать публичный репозиторий `errand-for-youtube` на GitHub и запушить код.
   - Описание: `Browser extension that hides YouTube Shorts, the home feed and recommendations, and asks what you came for. Free, open source, no tracking.`
   - Topics: `youtube`, `browser-extension`, `chrome-extension`, `firefox-addon`, `webextension`, `manifest-v3`, `youtube-shorts`, `distraction-free`, `digital-wellbeing`, `focus`, `productivity`, `privacy`
   - Settings → Pages → Deploy from branch → `main` / `/docs`. Сайт появится на `https://<user>.github.io/errand-for-youtube/`.
2. Заглушки заменены: сделано 2026-11-03.
3. `npm test && npm run build` → zip-файлы в `dist/`.

## 1. Chrome Web Store

1. Аккаунт разработчика: https://chrome.google.com/webstore/devconsole (разовый взнос $5, подтверждение личности).
2. New item → загрузить `dist/errand-chrome-<версия>.zip`.
3. Store listing:
   - Описание: из `store/listing/en.md` (то, что ниже строки «Description»). Для других языков переключить язык в выпадающем списке и вставить `ru.md`, `es.md`, `pt_BR.md`, `de.md`. Название и краткое описание подтягиваются из `_locales` автоматически.
   - Category: Productivity / Workflow & Planning.
   - Иконка 128×128: `icons/icon-128.png`.
   - Скриншоты 1280×800: `store/images/<язык>/screenshot-*.png`.
   - Small promo tile и Marquee глобальные, не по языкам: `store/images/en/promo-small-440x280.png`, `store/images/en/promo-marquee-1400x560.png`. По языкам только описание и скриншоты (https://developer.chrome.com/docs/webstore/cws-dashboard-listing).
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

## Обновление версии (чек-лист кабинета)

До кабинета:
1. Пройти ручной список из `notes/release/<версия>/qa.md` в своём Chrome (не в Arc с Enhanced protection): конец видео и «Остаться», автовоспроизведение выключено, сетка в конце скрыта, кнопка показа на 800 px, комментарии на стриме, бейдж без «!» на играющем видео. Написать «ручные ок».
2. Открыть `store/publish-chrome.html` из последней сборки и `dist/errand-chrome-X.Y.Z.zip`.

В кабинете (https://chrome.google.com/webstore/devconsole → Errand):
3. Package → Upload new package → zip. Проверить, что показана версия X.Y.Z.
4. Store listing, только если в `notes/release/X.Y.Z.md` отмечено «листинг менялся»: для en, ru, es, pt_BR, de вставить описание из шпаргалки.
5. Скриншоты, только если отмечено «скриншоты менялись»: для каждого языка удалить старые, загрузить `store/images/<язык>/screenshot-*.png` по порядку.
6. Промо-тайлы, только если отмечено: один раз, глобально, `store/images/en/promo-small-440x280.png` и `promo-marquee-1400x560.png`.
7. Privacy practices, только если менялись права или хранилище: ответы из шпаргалки, галочки сертификации.
8. Submit for review. Публиковать сразу после одобрения или отложенно, решает Тимур; агент записывает решение в `notes/release/X.Y.Z.md`.
9. Написать «отправил X.Y.Z» → release-manager ставит Status «X.Y.Z на проверке с <даты>» в `notes/roadmap.md`.
10. Пришло письмо: написать «одобрено» (→ `/release post`) или «отклонено + текст» (→ раунд правок).

## После публикации

Список шагов: `.claude/rules/release-pipeline.md`, этап 10 (release-manager, режим `post`).
