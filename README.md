# Errand for YouTube

YouTube always has one more video for you. **Errand for YouTube is a free, open-source Chrome extension that hides YouTube Shorts, the home feed, recommendations and the end screen, and offers to close the tab when your video ends.**

An alternative to Unhook, UnTrap and Remove YouTube Suggestions ([comparison](https://somestay07.github.io/errand-for-youtube/alternatives/)).

[Chrome Web Store](https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg) · [Website](https://somestay07.github.io/errand-for-youtube) · [По-русски](#по-русски)

![Errand: YouTube home asks what you came for](store/images/en/screenshot-1.png)

## What it does

- Home shows one question, "What are you here for?", instead of the feed. It can also open Subscriptions, Watch later or the usual feed.
- Shorts are hidden on home, search, subscriptions, channel pages and the sidebar. Their links open in the normal player, or are blocked.
- Video pages have no recommendations column. "Show recommendations" reveals it after 10 seconds. Comments are behind a button.
- At the end of a video nothing autoplays, and the end screen, end cards and fullscreen "More videos" grid are hidden. Errand asks "Got what you came for?" and offers to close the tab.
- With the default look, Mixes and empty-search suggestions are hidden too. Optional: live chat, the notification bell, view, like and subscriber counts, dimmed thumbnails.
- "Just hide Shorts" on install hides only Shorts and leaves the rest of YouTube as it is.
- Strict mode runs on a schedule and removes the "show" buttons during the hours you pick. Turning it off takes a 10-second wait, and on a schedule it skips only the current hours.
- A weekly count of errands done and tabs closed right after, stored only in your browser.
- "Pause 15 min" for when you need the feed for a moment; it turns itself back on (not in strict mode).
- When YouTube changes its layout and something Errand hides is back, the icon shows "!". Fixes go into the [breakage log](https://somestay07.github.io/errand-for-youtube/breakage/).

## Privacy

Errand makes no network requests and needs no account. Permissions: `www.youtube.com` (to hide elements) and `storage` (settings). See [PRIVACY.md](PRIVACY.md).

## Install from source

1. `npm run build` creates `dist/chrome` and `dist/errand-chrome-<version>.zip`. Other browsers: `node scripts/build.mjs firefox edge opera`.
2. Chrome: open `chrome://extensions`, turn on Developer mode, press Load unpacked and pick `dist/chrome`.

## Development

- `npm test`: logic, i18n key parity and store length limits.
- `node scripts/render.mjs`: icons from `assets/mark.svg`.
- `node scripts/store-images.mjs`: store screenshots per locale from `store/shots/`, promo tiles for en only (tiles are global in the Chrome Web Store).
- Languages: `_locales/{en,ru,es,pt_BR,de}`. The extension follows the browser's language.

Something leaked through after a YouTube update? [Open an issue](https://github.com/SomeStay07/errand-for-youtube/issues) with a screenshot.

Help translate: Errand is in English, Russian, Spanish, Brazilian Portuguese and German. To add a language or fix a string, [open an issue](https://github.com/SomeStay07/errand-for-youtube/issues).

License: GPL-3.0.

---

## По-русски

YouTube всегда подсунет ещё одно видео. Errand прячет Shorts, главную ленту, рекомендации и конечную заставку. Вместо ленты главная спрашивает: "Зачем вы здесь?" В конце видео следующее не включается само, если это не плейлист, и Errand предлагает закрыть вкладку. Рекомендации и комментарии открываются по кнопке, рекомендации через 10 секунд ожидания.

Бесплатно, код открыт, аккаунт не нужен. Запросов в сеть расширение не делает. Ставится из Chrome Web Store, в том числе в Яндекс Браузер, Brave и Vivaldi.

[Установить из Chrome Web Store](https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg)

Помочь с переводом: Errand есть на английском, русском, испанском, португальском (Бразилия) и немецком. Чтобы добавить язык или поправить строку, [напишите на GitHub](https://github.com/SomeStay07/errand-for-youtube/issues).
