import html
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs")
SITE = "https://somestay07.github.io/errand-for-youtube"
GH = "https://github.com/SomeStay07/errand-for-youtube"
PUBLISHED = "2026-11-03"
UPDATED = "2026-11-05"
STORE = {"chrome": "https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg", "firefox": GH, "edge": GH}

UBLOCK = """www.youtube.com##ytd-rich-shelf-renderer[is-shorts]
www.youtube.com##ytd-reel-shelf-renderer
www.youtube.com##ytd-rich-item-renderer:has(a[href^="/shorts/"])
www.youtube.com##grid-shelf-view-model:has(a[href^="/shorts/"])
www.youtube.com##ytd-guide-entry-renderer:has(a[href^="/shorts"])
www.youtube.com##ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])"""

UBLOCK_END = """www.youtube.com##.ytp-endscreen-content
www.youtube.com##.ytp-ce-element
www.youtube.com##.ytp-videowall-still
www.youtube.com##.ytp-modern-videowall-still
www.youtube.com##.ytp-suggestion-set
www.youtube.com##.ytp-fullscreen-grid"""

TEXT = {
    "en": {
        "lang": "en", "home": "../", "cta": "Add to Chrome", "free": "Free and open source, no account needed. Errand makes no network requests.",
        "updated": "Updated November 2026", "guides": "Guides", "faq": "Questions", "report": "Report a problem", "translate": "Help translate", "breakage": "Breakage log",
    },
    "ru": {
        "lang": "ru", "home": "../", "cta": "Установить в Chrome", "free": "Бесплатно, код открыт, аккаунт не нужен. Errand не делает запросов в сеть.",
        "updated": "Обновлено в ноябре 2026", "guides": "Инструкции", "faq": "Вопросы", "report": "Сообщить о проблеме", "translate": "Помочь с переводом", "breakage": "Журнал поломок (англ.)",
    },
}


PAIRS = {
    "hide-youtube-shorts": "kak-ubrat-shorts-youtube",
    "youtube-without-recommendations": "youtube-bez-rekomendaciy",
    "hide-youtube-end-screen": "kak-ubrat-konechnuyu-zastavku-youtube",
}

PAGES = [
    {
        "slug": "hide-youtube-shorts", "loc": "en", "depth": 1,
        "title": "How to hide YouTube Shorts on desktop in Chrome",
        "h1": "How to hide YouTube Shorts on desktop",
        "desc": "YouTube has no switch to turn Shorts off. What the built-in options really do, a uBlock Origin filter, and a free extension that removes Shorts everywhere.",
        "body": f"""
<p class="lead"><b>Short answer:</b> YouTube has no setting that turns Shorts off on a computer. "Not interested" hides a Shorts shelf for a while, then it comes back. To remove Shorts for good you need a content filter or an extension.</p>

<h2>What YouTube lets you do</h2>
<ul>
<li>On the home page, the Shorts shelf has a menu with "Not interested". YouTube hides that shelf for a while; it returns later.</li>
<li>Pausing watch history empties the home page, Shorts shelf included. You lose the whole home feed, and Shorts still appear in search and on channel pages.</li>
<li>There is no setting for Shorts in search results, the subscriptions feed or the sidebar.</li>
</ul>

<h2>Option 1: a uBlock Origin filter</h2>
<p>In Firefox, open the uBlock Origin dashboard, go to <i>My filters</i> and paste:</p>
<pre>{html.escape(UBLOCK)}</pre>
<p>Chrome stopped running uBlock Origin in 2025. Its Chrome version, uBlock Origin Lite, also takes custom element-hiding filters, but where you paste them depends on the version, and these rules haven't been tested in it.</p>
<p>These rules match YouTube's layout as of November 2026. When YouTube renames these page elements, filters stop working without telling you, and you have to update them yourself.</p>

<h2>Option 2: an extension</h2>
<p><a href="../">Errand</a> hides Shorts on the home page, in search, in subscriptions, on channel pages and in the sidebar. Links to Shorts open as normal videos with regular controls, or can be blocked completely. After each page load it checks whether any Shorts slipped through and shows "!" on its icon if YouTube changed something.</p>
<p>If Shorts are all you want gone, pick "Just hide Shorts" when you install. The feed, recommendations, comments and the end screen stay the way YouTube shows them.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Add to Chrome</a></p>
<p>Other extensions that hide Shorts: Unhook, UnTrap, Remove YouTube Suggestions, Control Panel for YouTube. See the <a href="../alternatives/">comparison</a>. The end of a video has its own guide: <a href="../hide-youtube-end-screen/">how to hide the YouTube end screen</a>.</p>

<h2>Where Shorts show up</h2>
<ul>
<li>the shelf on the home page</li>
<li>the "Shorts" tab on channel pages</li>
<li>the left sidebar</li>
<li>links shared from phones, which open the vertical Shorts player</li>
</ul>

<h2 id="search">Shorts in search results</h2>
<p>Search mixes a Shorts grid in with the videos and adds a "Shorts" filter chip above them. YouTube has no setting for either. Errand hides the grid, single Shorts in the results and the chip.</p>

<h2 id="subscriptions">Shorts in the subscriptions feed</h2>
<p>The subscriptions feed shows a Shorts shelf from the channels you follow, and YouTube has no setting to turn it off. Errand hides that shelf and single Shorts in the feed.</p>
""",
        "faq": [
            ("Can I watch a Short as a normal video?", "Yes. In the address, replace /shorts/ with /watch?v= and keep the video ID. Errand does this automatically for every Shorts link."),
            ("Does hiding Shorts change what YouTube recommends?", "Not directly. Hiding only stops Shorts from being shown to you; YouTube's recommendations are unchanged."),
            ("Does this work in the YouTube app on my phone?", "No. Browser extensions work in desktop browsers; the YouTube app on phones can't be changed by extensions."),
        ],
    },
    {
        "slug": "youtube-without-recommendations", "loc": "en", "depth": 1,
        "title": "How to use YouTube without recommendations or autoplay",
        "h1": "How to use YouTube without recommendations",
        "desc": "Two ways to stop YouTube recommendations on desktop: pause watch history, or hide the recommendation column, end screen and autoplay with a free extension.",
        "body": f"""
<p class="lead">Pause watch history and YouTube stops filling the home page with recommendations, but video pages still show them. To remove the column next to every video, the end screen and autoplay, use an extension.</p>

<h2>Built in: pause watch history</h2>
<p>Open <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a> and pause watch history. With history off, the home page no longer shows a recommended feed. The cost: you lose your history, and recommendations stay next to every video and at the end of it.</p>

<h2>Built in: the autoplay switch</h2>
<p>The switch at the bottom of the player turns autoplay off. YouTube remembers it per browser, and the end-of-video suggestions still appear.</p>

<h2>With an extension</h2>
<p><a href="../">Errand</a> removes the recommendation column on video pages, the end screen and end cards, Mixes and the "Next" button, and keeps autoplay off outside playlists. More on the end of a video: <a href="../hide-youtube-end-screen/">how to hide the YouTube end screen</a>. The home page asks "What are you here for?" instead of showing a feed. If you need recommendations, "Show recommendations" brings them back after 10 seconds. Strict mode removes that button during the hours you pick.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Add to Chrome</a></p>
""",
        "faq": [
            ("Will YouTube still learn from what I watch?", "Yes. An extension only changes what the page shows you; YouTube's own history and recommendations work as before unless you pause watch history."),
            ("Can I still see recommendations sometimes?", "Yes. In Errand, \"Show recommendations\" on a video page reveals the column after a 10-second wait."),
            ("Does it hide comments too?", "By default comments sit behind a \"Show comments\" button. You can turn that off in the menu."),
        ],
    },
    {
        "slug": "alternatives", "loc": "en", "depth": 1,
        "title": "Unhook alternatives: YouTube distraction blockers compared",
        "h1": "Unhook, UnTrap, Remove YouTube Suggestions and others compared",
        "desc": "Free and paid extensions that hide YouTube Shorts and recommendations, compared by price, source code, browsers and last update, as of November 2026.",
        "body": """
<p class="lead">Most of these hide Shorts and recommendations. They differ in price, whether you can read the code, which browsers they run in, and the one thing each does best. If another one fits you better, use it.</p>
<div class="table">
<table>
<thead><tr><th>Extension</th><th>Price</th><th>Source code</th><th>Browsers</th><th>Last update</th><th>Best at</th></tr></thead>
<tbody>
<tr><td><a href="../">Errand</a></td><td>Free</td><td>Open, GPL-3.0</td><td>Chrome</td><td>Not in stores yet: v0.1 is in review</td><td>Ending the visit: it asks what you came for and offers to close the tab. Shows "!" when YouTube breaks a filter</td></tr>
<tr><td>Unhook</td><td>Free</td><td>Closed</td><td>Chrome, Firefox, Edge</td><td>March 2026 (Chrome), April 2026 (Firefox)</td><td>Simple on/off switches for many page parts</td></tr>
<tr><td>UnTrap</td><td>Free core features, paid upgrade</td><td>Closed</td><td>Chrome, Firefox, Edge, Safari (also iPhone and iPad)</td><td>October 2026</td><td>A very long list of settings, content filters, AI video summaries</td></tr>
<tr><td>Remove YouTube Suggestions</td><td>Free core features, premium for a few dollars a month</td><td>Open, MPL-2.0</td><td>Chrome, Firefox</td><td>October 2026</td><td>Many options, including a schedule and a 10-second timer before settings change</td></tr>
<tr><td>BlockTube</td><td>Free</td><td>Open, GPL-3.0</td><td>Chrome, Firefox</td><td>February 2026</td><td>Blocking specific channels and keywords</td></tr>
<tr><td>Control Panel for YouTube</td><td>Free in Chrome, Firefox and Edge</td><td>Published on GitHub</td><td>Chrome, Firefox, Edge, Safari</td><td>October 2026</td><td>Fine-grained layout tweaks</td></tr>
</tbody>
</table>
</div>
<p class="small">As of November 3, 2026, from each extension's own site and store pages: <a href="https://unhook.app/">unhook.app</a>, <a href="https://untrap.app/">untrap.app</a>, <a href="https://lawrencehook.com/rys/premium/">Remove YouTube Suggestions premium</a>, <a href="https://github.com/amitbl/blocktube">BlockTube on GitHub</a>, <a href="https://soitis.dev/control-panel-for-youtube">soitis.dev</a>, and their Chrome Web Store and Firefox Add-ons pages. Prices and features change; <a href="https://github.com/SomeStay07/errand-for-youtube/issues">tell me</a> if something here is out of date.</p>

<h2>When to pick something else</h2>
<ul>
<li>You want to block particular channels or words: BlockTube.</li>
<li>You watch in Safari on an iPhone or iPad: UnTrap or Control Panel for YouTube. Neither changes the YouTube app itself.</li>
<li>You want every possible switch: Control Panel for YouTube, UnTrap or Remove YouTube Suggestions.</li>
</ul>

<h2>Coming from Unhook</h2>
<p>Most of Unhook's main switches have a match in Errand: the home feed, recommendations, Shorts, comments, the end screen and end cards, Mixes, live chat, the bell and autoplay. Errand starts from three presets instead of a list of switches, and the menu lets you change single parts later. Unhook can also hide things Errand doesn't touch, such as the video description or the top header. Settings don't carry over, so turn Unhook off while you try Errand.</p>

<h2>Why Errand exists</h2>
<p>Across about 4,000 reviews of extensions like these, the most common reason for a one-star rating was "stopped working after a YouTube update". Errand checks on every home, search and video page that it still finds what it hides, and shows "!" when something slipped back. Each breakage goes into a <a href="../breakage/">public log</a> with the dates it was found and fixed. Errand doesn't block requests or touch ads, so it's unlikely to set off YouTube's ad-blocker warning.</p>
""",
        "faq": [
            ("Is Errand free?", "Yes, and its code is open under GPL-3.0."),
            ("When was Unhook last updated?", "As of November 3, 2026: March 22, 2026 in the Chrome Web Store and April 9, 2026 on Firefox Add-ons."),
            ("Which of these are open source?", "Errand (GPL-3.0), Remove YouTube Suggestions (MPL-2.0) and BlockTube (GPL-3.0). Unhook and UnTrap are closed source. Control Panel for YouTube publishes its code on GitHub."),
            ("Does Errand block ads?", "No. Use uBlock Origin for ads (in Chrome, uBlock Origin Lite); the two work together."),
        ],
    },
    {
        "slug": "hide-youtube-end-screen", "loc": "en", "depth": 1,
        "title": "How to hide the YouTube end screen and end cards",
        "h1": "How to hide the YouTube end screen",
        "desc": "What the autoplay switch leaves at the end of a video, a uBlock Origin filter for the end screen and end cards, and a free extension that hides them.",
        "body": f"""
<p class="lead">Turning autoplay off stops the next video from starting, but the end screen, its tiles and the wall of suggested videos still show up. To hide them you need a content filter or an extension.</p>

<h2>What shows up at the end of a video</h2>
<ul>
<li>The end screen: tiles with videos, playlists or a subscribe button that the creator puts over the last 5 to 20 seconds. YouTube calls these tiles end screen elements; most people say end cards.</li>
<li>The video wall: a grid of suggested videos that covers the player once the video stops.</li>
<li>In fullscreen, the "More videos" grid with suggestions that slides up over the picture.</li>
</ul>

<h2>What YouTube lets you do</h2>
<p>The autoplay switch at the bottom of the player stops the next video. It doesn't touch the end screen or the video wall. Creators decide whether a video has an end screen at all, so on some videos you won't see one.</p>

<h2>Option 1: a uBlock Origin filter</h2>
<p>In Firefox, open the uBlock Origin dashboard, go to <i>My filters</i> and paste:</p>
<pre>{html.escape(UBLOCK_END)}</pre>
<p>Chrome stopped running uBlock Origin in 2025. Its Chrome version, uBlock Origin Lite, also takes custom element-hiding filters, but where you paste them depends on the version, and these rules haven't been tested in it.</p>
<p>These rules match YouTube's player as of November 2026. When YouTube renames these parts of the player, the filter stops working without telling you.</p>

<h2>Option 2: an extension</h2>
<p><a href="../">Errand</a> hides the end screen, end cards, the video wall and the fullscreen "More videos" grid, and keeps autoplay off outside playlists. When your video ends, it asks "Got what you came for?" and offers to close the tab. If YouTube changes the player and Errand can't find the end screen any more, its icon shows "!".</p>
<p>If you picked "Just hide Shorts" on install, the end screen stays as YouTube shows it. Turn on "Hide end screen and end cards" in Errand's menu to hide it.</p>
<p>More guides: <a href="../hide-youtube-shorts/">how to hide YouTube Shorts on desktop</a>, <a href="../alternatives/">Unhook and other extensions compared</a>.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Add to Chrome</a></p>
""",
        "faq": [
            ("Does turning off autoplay hide the end screen?", "No. It only stops the next video from starting. The end screen tiles and the video wall still appear."),
            ("Why do some videos have no end screen?", "Creators add end screens themselves, and not every video has one."),
            ("Do playlists still play with the end screen hidden?", "Yes. Errand hides the suggestions, and a playlist moves on to its next video as usual."),
        ],
    },
    {
        "slug": "kak-ubrat-shorts-youtube", "loc": "ru", "depth": 2,
        "title": "Как убрать Shorts на YouTube на компьютере",
        "h1": "Как убрать Shorts на YouTube на компьютере",
        "desc": "Выключить Shorts в настройках YouTube нельзя. Что дают встроенные кнопки, фильтр для uBlock Origin и бесплатное расширение, которое убирает шортсы везде.",
        "body": f"""
<p class="lead"><b>Коротко:</b> в настройках YouTube нет переключателя, который выключает Shorts. Пункт "Не интересует" прячет полку с шортсами на время, потом она возвращается. Чтобы убрать их насовсем, нужен фильтр или расширение.</p>

<h2>Что умеет сам YouTube</h2>
<ul>
<li>У полки Shorts на главной есть меню с пунктом "Не интересует". Полка пропадает на время и потом появляется снова.</li>
<li>Если приостановить историю просмотра, главная станет пустой вместе с полкой Shorts. Но пропадёт вся лента, и шортсы всё равно останутся в поиске и на каналах.</li>
<li>Для Shorts в поиске, подписках и боковом меню настроек нет.</li>
</ul>

<h2>Способ 1: фильтр для uBlock Origin</h2>
<p>В Firefox откройте панель uBlock Origin, вкладку "Мои фильтры", и вставьте:</p>
<pre>{html.escape(UBLOCK)}</pre>
<p>В Chrome uBlock Origin не работает с 2025 года. Его версия для Chrome, uBlock Origin Lite, тоже принимает свои фильтры для скрытия элементов, но место для них зависит от версии, а эти правила в нём пока не проверены.</p>
<p>Правила подходят к вёрстке YouTube на ноябрь 2026 года. Когда YouTube переименует эти элементы, фильтр перестанет работать без предупреждения, и обновлять его придётся самим.</p>

<h2>Способ 2: расширение</h2>
<p><a href="../">Errand</a> убирает Shorts с главной, из поиска, подписок, страниц каналов и меню. Ссылки на шортсы открываются как обычные видео с перемоткой или не открываются вовсе, как настроите. После загрузки страницы расширение проверяет, не проскочили ли шортсы, и показывает "!" на иконке, если YouTube что-то поменял.</p>
<p>Если мешают только шортсы, при установке выберите "Просто убрать Shorts". Лента, рекомендации, комментарии и конечная заставка останутся такими, как их показывает YouTube.</p>
<p>Ещё инструкции: <a href="../kak-ubrat-konechnuyu-zastavku-youtube/">как убрать конечную заставку YouTube</a>, <a href="../../alternatives/">сравнение с Unhook и другими (на английском)</a>.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Установить в Chrome</a></p>

<h2>В Яндекс Браузере</h2>
<p>Яндекс Браузер ставит расширения из Chrome Web Store: откройте страницу Errand в магазине и нажмите "Установить".</p>
""",
        "faq": [
            ("Можно смотреть шортс как обычное видео?", "Да. В адресе замените /shorts/ на /watch?v= и оставьте номер видео. Errand делает это сам для каждой ссылки на Shorts."),
            ("Это работает в приложении YouTube на телефоне?", "Нет. Расширения работают только в браузерах на компьютере."),
        ],
    },
    {
        "slug": "youtube-bez-rekomendaciy", "loc": "ru", "depth": 2,
        "title": "YouTube без рекомендаций и автовоспроизведения",
        "h1": "YouTube без рекомендаций и автовоспроизведения",
        "desc": "Как убрать рекомендации YouTube на компьютере: история просмотра, переключатель автовоспроизведения и бесплатное расширение, которое прячет колонку и конечную заставку.",
        "body": f"""
<p class="lead">Если приостановить историю просмотра, главная перестанет заполняться рекомендациями, но рядом с каждым видео они останутся. Чтобы убрать колонку рекомендаций, конечную заставку и автовоспроизведение, нужно расширение.</p>

<h2>Встроенный способ: история просмотра</h2>
<p>Откройте <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a> и приостановите историю. Главная станет пустой. Цена: истории больше нет, и рекомендации рядом с видео и в конце никуда не денутся.</p>

<h2>Переключатель автовоспроизведения</h2>
<p>Переключатель внизу плеера выключает автовоспроизведение в этом браузере. Подборка видео в конце ролика всё равно появляется.</p>

<h2>Расширение</h2>
<p><a href="../">Errand</a> убирает колонку рекомендаций, конечную заставку, миксы и кнопку "Следующее видео" и держит автовоспроизведение выключенным везде, кроме плейлистов. Подробнее про конец видео: <a href="../kak-ubrat-konechnuyu-zastavku-youtube/">как убрать конечную заставку YouTube</a>. Вместо ленты главная спрашивает "Что ищете?". Если рекомендации нужны, кнопка "Показать рекомендации" откроет их через 10 секунд. Строгий режим убирает и эту кнопку в выбранные часы.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Установить в Chrome</a></p>
""",
        "faq": [
            ("YouTube продолжит учитывать, что я смотрю?", "Да. Расширение меняет только то, что показывает страница. История и рекомендации YouTube работают как раньше, если не приостановить историю."),
            ("Можно иногда посмотреть рекомендации?", "Да. Кнопка \"Показать рекомендации\" на странице видео открывает их через 10 секунд."),
        ],
    },
    {
        "slug": "kak-ubrat-konechnuyu-zastavku-youtube", "loc": "ru", "depth": 2,
        "title": "Как убрать конечную заставку на YouTube",
        "h1": "Как убрать конечную заставку на YouTube",
        "desc": "Что остаётся в конце видео, если выключить автовоспроизведение, фильтр для uBlock Origin и бесплатное расширение, которое прячет конечную заставку.",
        "body": f"""
<p class="lead">Если выключить автовоспроизведение, следующее видео не начнётся, но конечная заставка и стена рекомендованных видео всё равно появятся. Чтобы их убрать, нужен фильтр или расширение.</p>

<h2>Что появляется в конце видео</h2>
<ul>
<li>Конечная заставка: плитки с видео, плейлистами или кнопкой подписки, которые автор ставит на последние 5-20 секунд ролика.</li>
<li>Стена видео: сетка рекомендаций, которая закрывает плеер, когда ролик остановился.</li>
<li>В полноэкранном режиме сетка с другими видео, которая выезжает поверх картинки.</li>
</ul>

<h2>Что умеет сам YouTube</h2>
<p>Переключатель автовоспроизведения внизу плеера останавливает следующее видео. Заставку и стену видео он не трогает. Ставить ли заставку, решает автор ролика, поэтому на части видео её нет.</p>

<h2>Способ 1: фильтр для uBlock Origin</h2>
<p>В Firefox откройте панель uBlock Origin, вкладку "Мои фильтры", и вставьте:</p>
<pre>{html.escape(UBLOCK_END)}</pre>
<p>В Chrome uBlock Origin не работает с 2025 года. Его версия для Chrome, uBlock Origin Lite, тоже принимает свои фильтры для скрытия элементов, но место для них зависит от версии, а эти правила в нём пока не проверены.</p>
<p>Правила подходят к плееру YouTube на ноябрь 2026 года. Когда YouTube переименует эти части плеера, фильтр перестанет работать без предупреждения.</p>

<h2>Способ 2: расширение</h2>
<p><a href="../">Errand</a> прячет конечную заставку, стену видео и сетку в полноэкранном режиме и держит автовоспроизведение выключенным везде, кроме плейлистов. Когда видео закончится, он спросит, получилось ли найти нужное, и предложит закрыть вкладку. Если YouTube поменяет плеер и Errand перестанет находить заставку, на его иконке появится "!".</p>
<p>Если при установке вы выбрали "Просто убрать Shorts", заставка остаётся такой, как её показывает YouTube. Чтобы её спрятать, включите в меню Errand "Скрывать конечную заставку".</p>
<p>Ещё инструкции: <a href="../kak-ubrat-shorts-youtube/">как убрать Shorts на YouTube</a>, <a href="../../alternatives/">сравнение с Unhook и другими (на английском)</a>.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Установить в Chrome</a></p>
""",
        "faq": [
            ("Если выключить автовоспроизведение, заставка пропадёт?", "Нет. Следующее видео не начнётся, но плитки заставки и стена видео всё равно появятся."),
            ("Почему на некоторых видео заставки нет?", "Заставку добавляет автор ролика, и есть она не на каждом видео."),
            ("Плейлисты играют дальше, если заставка скрыта?", "Да. Errand прячет рекомендации, а плейлист переходит к следующему видео как обычно."),
        ],
    },
]


def page_html(p):
    t = TEXT[p["loc"]]
    up = "../" * p["depth"]
    url = f"{SITE}/{'ru/' if p['loc'] == 'ru' else ''}{p['slug']}/"
    img = f"{SITE}/assets/og-{'ru' if p['loc'] == 'ru' else 'en'}.png"
    faq_html = "".join(f"<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>" for q, a in p["faq"])
    ld = [
        {
            "@context": "https://schema.org", "@type": "TechArticle", "headline": p["h1"], "description": p["desc"],
            "inLanguage": p["loc"], "datePublished": PUBLISHED, "dateModified": UPDATED, "url": url, "image": img,
            "author": {"@type": "Person", "name": "Timur Cheberda", "url": "https://github.com/SomeStay07"},
            "about": {"@type": "SoftwareApplication", "name": "Errand for YouTube", "url": f"{SITE}/"},
        },
        {
            "@context": "https://schema.org", "@type": "FAQPage", "inLanguage": p["loc"],
            "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]],
        },
    ]
    alts = []
    if p["loc"] == "en":
        alts.append(("en", url))
        if p["slug"] in PAIRS:
            alts.append(("ru", f"{SITE}/ru/{PAIRS[p['slug']]}/"))
        alts.append(("x-default", url))
    else:
        en = next((k for k, v in PAIRS.items() if v == p["slug"]), None)
        if en:
            alts += [("en", f"{SITE}/{en}/"), ("x-default", f"{SITE}/{en}/")]
        alts.append(("ru", url))
    alt_html = "".join(f'\n  <link rel="alternate" hreflang="{h}" href="{u}">' for h, u in alts)
    return f"""<!DOCTYPE html>
<html lang="{p['loc']}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(p['title'])}</title>
  <meta name="description" content="{html.escape(p['desc'])}">
  <link rel="canonical" href="{url}">{alt_html}
  <link rel="icon" href="{up}assets/favicon.png">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{html.escape(p['title'])}">
  <meta property="og:description" content="{html.escape(p['desc'])}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{img}">
  <meta property="og:image:alt" content="Errand for YouTube">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="{up}style.css">
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
  <header class="top">
    <a class="brand" href="{t['home']}"><img src="{up}assets/icon.png" alt="" width="32" height="32"> Errand</a>
    <nav><a href="{GH}">GitHub</a></nav>
  </header>
  <main>
    <article>
      <section class="hero">
        <p class="small">{t['updated']}</p>
        <h1>{html.escape(p['h1'])}</h1>
        {p['body']}
      </section>
      <section>
        <h2>{t['faq']}</h2>
        {faq_html}
        <p class="small">{t['free']}</p>
      </section>
    </article>
  </main>
  <footer><a href="{t['home']}">Errand</a> · <a href="{GH}">GitHub</a> · <a href="{GH}/issues">{t['report']}</a> · <a href="{GH}/issues">{t['translate']}</a> · <a href="{SITE}/breakage/">{t['breakage']}</a></footer>
</body>
</html>
"""


for p in PAGES:
    folder = os.path.join(ROOT, "ru" if p["loc"] == "ru" else "", p["slug"])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "index.html"), "w") as f:
        f.write(page_html(p))
    print(os.path.relpath(os.path.join(folder, "index.html"), ROOT))

urls = [f"{SITE}/", f"{SITE}/ru/", f"{SITE}/breakage/", f"{SITE}/changes/", f"{SITE}/ru/changes/"] + [f"{SITE}/{'ru/' if p['loc'] == 'ru' else ''}{p['slug']}/" for p in PAGES]
with open(os.path.join(ROOT, "sitemap.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        f.write(f"  <url><loc>{u}</loc><lastmod>{UPDATED}</lastmod></url>\n")
    f.write("</urlset>\n")
print("sitemap:", len(urls))
