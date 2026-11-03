import html
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs")
SITE = "https://somestay07.github.io/errand-for-youtube"
GH = "https://github.com/SomeStay07/errand-for-youtube"
UPDATED = "2026-11-03"
STORE = {"chrome": GH, "firefox": GH, "edge": GH}

UBLOCK = """www.youtube.com##ytd-rich-shelf-renderer[is-shorts]
www.youtube.com##ytd-reel-shelf-renderer
www.youtube.com##ytd-rich-item-renderer:has(a[href^="/shorts/"])
www.youtube.com##grid-shelf-view-model:has(a[href^="/shorts/"])
www.youtube.com##ytd-guide-entry-renderer:has(a[href^="/shorts"])
www.youtube.com##ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])"""

TEXT = {
    "en": {
        "lang": "en", "home": "../", "cta": "Add to Chrome", "free": "Free and open source. No account, no analytics, no network requests.",
        "updated": "Updated November 2026", "guides": "Guides", "faq": "Questions", "report": "Report a problem",
    },
    "ru": {
        "lang": "ru", "home": "../", "cta": "Установить в Chrome", "free": "Бесплатно, код открыт. Без аккаунтов, аналитики и запросов в сеть.",
        "updated": "Обновлено в ноябре 2026", "guides": "Инструкции", "faq": "Вопросы", "report": "Сообщить о проблеме",
    },
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
<p>If you already use uBlock Origin, open its dashboard → <i>My filters</i> and paste:</p>
<pre>{html.escape(UBLOCK)}</pre>
<p>These rules match YouTube's layout as of November 2026. When YouTube renames these page elements, filters stop working without telling you, and you have to update them yourself.</p>

<h2>Option 2: an extension</h2>
<p><a href="../">Errand</a> hides Shorts on the home page, in search, in subscriptions, on channel pages and in the sidebar. Links to Shorts open as normal videos with regular controls, or can be blocked completely. After each page load it checks whether any Shorts slipped through and shows "!" on its icon if YouTube changed something.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Add to Chrome</a></p>
<p>Other extensions that hide Shorts: Unhook, Remove YouTube Suggestions, Control Panel for YouTube. See the <a href="../alternatives/">comparison</a>.</p>

<h2>Where Shorts show up</h2>
<ul>
<li>the shelf on the home page</li>
<li>search results: a Shorts grid and a "Shorts" filter chip</li>
<li>the subscriptions feed</li>
<li>the "Shorts" tab on channel pages</li>
<li>the left sidebar</li>
<li>links shared from phones, which open the vertical Shorts player</li>
</ul>
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
<p class="lead"><b>Short answer:</b> pause watch history and YouTube stops filling the home page with recommendations, but video pages still show them. To remove the column next to every video, the wall of thumbnails at the end and autoplay, use an extension.</p>

<h2>Built in: pause watch history</h2>
<p>Open <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a> and pause watch history. With history off, the home page no longer shows a recommended feed. The cost: you lose your history, and recommendations stay next to every video and at the end of it.</p>

<h2>Built in: the autoplay switch</h2>
<p>The switch at the bottom of the player turns autoplay off. YouTube remembers it per browser, and the end-of-video suggestions still appear.</p>

<h2>With an extension</h2>
<p><a href="../">Errand</a> removes the recommendation column on video pages, the thumbnail wall at the end, Mixes and the "Next" button, and keeps autoplay off. The home page asks "What are you here for?" instead of showing a feed. If you need recommendations, "Show recommendations" brings them back after 10 seconds. Strict mode removes that button during the hours you pick.</p>
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
        "h1": "Unhook, BlockTube and other YouTube blockers: an honest comparison",
        "desc": "Free and paid extensions that hide YouTube Shorts and recommendations, compared by price, source code and what each one is best at.",
        "body": """
<p class="lead">Most extensions in this list hide Shorts and recommendations. They differ in price, whether you can read their code, and the one thing each does best. If another one fits you better, use it.</p>
<div class="table">
<table>
<thead><tr><th>Extension</th><th>Price</th><th>Source code</th><th>Best at</th></tr></thead>
<tbody>
<tr><td><a href="../">Errand</a></td><td>Free</td><td>Open, GPL-3.0</td><td>Asking what you came for, offering to close the tab, warning when YouTube changes its layout</td></tr>
<tr><td>Unhook</td><td>Free</td><td>Closed</td><td>Simple on/off switches for many page parts</td></tr>
<tr><td>Remove YouTube Suggestions</td><td>Free, with a paid tier</td><td>Open, MPL-2.0</td><td>A very long list of options</td></tr>
<tr><td>BlockTube</td><td>Free</td><td>Open, GPL-3.0</td><td>Blocking specific channels and keywords</td></tr>
<tr><td>Control Panel for YouTube</td><td>Free on desktop</td><td>Open</td><td>Fine-grained layout tweaks</td></tr>
<tr><td>UnTrap</td><td>Paid</td><td>Closed</td><td>iPhone and iPad (Safari)</td></tr>
</tbody>
</table>
</div>
<p class="small">Checked in November 2026. Prices and features change; <a href="https://github.com/SomeStay07/errand-for-youtube/issues">tell me</a> if something here is out of date.</p>

<h2>When to pick something else</h2>
<ul>
<li>You want to block particular channels or words: BlockTube.</li>
<li>You watch on an iPhone: UnTrap; desktop extensions don't run in phone apps.</li>
<li>You want every possible switch: Control Panel for YouTube or Remove YouTube Suggestions.</li>
</ul>

<h2>Why Errand exists</h2>
<p>Across about 4,000 reviews of extensions like these, the most common reason for a one-star rating was "stopped working after a YouTube update". Errand checks on every home, search and video page that it still finds what it hides, and shows "!" when something slipped back. It doesn't block requests or touch ads, so it's unlikely to set off YouTube's ad-blocker warning.</p>
""",
        "faq": [
            ("Is Errand free?", "Yes, and its code is open under GPL-3.0."),
            ("Does Errand block ads?", "No. Use uBlock Origin for ads; the two work together."),
        ],
    },
    {
        "slug": "kak-ubrat-shorts-youtube", "loc": "ru", "depth": 2,
        "title": "Как убрать Shorts на YouTube на компьютере",
        "h1": "Как убрать Shorts на YouTube на компьютере",
        "desc": "Выключить Shorts в настройках YouTube нельзя. Что дают встроенные кнопки, фильтр для uBlock Origin и бесплатное расширение, которое убирает шортсы везде.",
        "body": f"""
<p class="lead"><b>Коротко:</b> в настройках YouTube нет переключателя, который выключает Shorts. «Не интересует» прячет полку с шортсами на время, потом она возвращается. Чтобы убрать их насовсем, нужен фильтр или расширение.</p>

<h2>Что умеет сам YouTube</h2>
<ul>
<li>У полки Shorts на главной есть меню с пунктом «Не интересует». Полка пропадает на время и потом появляется снова.</li>
<li>Если приостановить историю просмотра, главная станет пустой вместе с полкой Shorts. Но пропадёт вся лента, а шортсы останутся в поиске и на каналах.</li>
<li>Для Shorts в поиске, подписках и боковом меню настроек нет.</li>
</ul>

<h2>Способ 1: фильтр для uBlock Origin</h2>
<p>Если uBlock Origin уже стоит, откройте его панель → «Мои фильтры» и вставьте:</p>
<pre>{html.escape(UBLOCK)}</pre>
<p>Правила подходят к вёрстке YouTube на ноябрь 2026 года. Когда YouTube переименует эти элементы, фильтр молча перестанет работать, и обновлять его придётся самим.</p>

<h2>Способ 2: расширение</h2>
<p><a href="../">Errand</a> убирает Shorts с главной, из поиска, подписок, страниц каналов и меню. Ссылки на шортсы открываются как обычные видео с перемоткой, или не открываются вовсе, как настроите. После загрузки страницы расширение проверяет, не проскочили ли шортсы, и показывает «!» на иконке, если YouTube что-то поменял.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Установить в Chrome</a></p>

<h2>В Яндекс Браузере</h2>
<p>Яндекс Браузер ставит расширения из Chrome Web Store: откройте страницу Errand в магазине и нажмите «Установить».</p>
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
<p class="lead"><b>Коротко:</b> если приостановить историю просмотра, главная перестанет заполняться рекомендациями, но рядом с каждым видео они останутся. Чтобы убрать колонку рекомендаций, стену превью в конце и автовоспроизведение, нужно расширение.</p>

<h2>Встроенный способ: история просмотра</h2>
<p>Откройте <a href="https://www.youtube.com/feed/history">youtube.com/feed/history</a> и приостановите историю. Главная станет пустой. Цена: истории больше нет, а рекомендации рядом с видео и в конце никуда не денутся.</p>

<h2>Переключатель автовоспроизведения</h2>
<p>Переключатель внизу плеера выключает автовоспроизведение в этом браузере. Подборка видео в конце ролика всё равно появляется.</p>

<h2>Расширение</h2>
<p><a href="../">Errand</a> убирает колонку рекомендаций, стену превью в конце, миксы и кнопку «Следующее видео», держит автовоспроизведение выключенным. Вместо ленты главная спрашивает «Зачем вы здесь?». Если рекомендации нужны, кнопка «Показать рекомендации» откроет их через 10 секунд. Строгий режим убирает и эту кнопку в выбранные часы.</p>
<p class="cta"><a class="button primary" href="{STORE['chrome']}">Установить в Chrome</a></p>
""",
        "faq": [
            ("YouTube продолжит учитывать, что я смотрю?", "Да. Расширение меняет только то, что показывает страница. История и рекомендации YouTube работают как раньше, если не приостановить историю."),
            ("Можно иногда посмотреть рекомендации?", "Да. Кнопка «Показать рекомендации» на странице видео открывает их через 10 секунд."),
        ],
    },
]


def page_html(p):
    t = TEXT[p["loc"]]
    up = "../" * p["depth"]
    url = f"{SITE}/{'ru/' if p['loc'] == 'ru' else ''}{p['slug']}/"
    faq_html = "".join(f"<h3>{html.escape(q)}</h3><p>{html.escape(a)}</p>" for q, a in p["faq"])
    ld = [
        {
            "@context": "https://schema.org", "@type": "TechArticle", "headline": p["h1"], "description": p["desc"],
            "inLanguage": p["loc"], "dateModified": UPDATED, "url": url,
            "author": {"@type": "Person", "name": "Timur Cheberda", "url": "https://github.com/SomeStay07"},
            "about": {"@type": "SoftwareApplication", "name": "Errand for YouTube", "url": f"{SITE}/"},
        },
        {
            "@context": "https://schema.org", "@type": "FAQPage", "inLanguage": p["loc"],
            "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]],
        },
    ]
    return f"""<!doctype html>
<html lang="{p['loc']}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(p['title'])}</title>
  <meta name="description" content="{html.escape(p['desc'])}">
  <link rel="canonical" href="{url}">
  <link rel="icon" href="{up}assets/favicon.png">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{html.escape(p['title'])}">
  <meta property="og:description" content="{html.escape(p['desc'])}">
  <meta property="og:image" content="{SITE}/assets/og-{'ru' if p['loc'] == 'ru' else 'en'}.png">
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
  <footer><a href="{t['home']}">Errand</a> · <a href="{GH}">GitHub</a> · <a href="{GH}/issues">{t['report']}</a></footer>
</body>
</html>
"""


for p in PAGES:
    folder = os.path.join(ROOT, "ru" if p["loc"] == "ru" else "", p["slug"])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "index.html"), "w") as f:
        f.write(page_html(p))
    print(os.path.relpath(os.path.join(folder, "index.html"), ROOT))

urls = [f"{SITE}/", f"{SITE}/ru/"] + [f"{SITE}/{'ru/' if p['loc'] == 'ru' else ''}{p['slug']}/" for p in PAGES]
with open(os.path.join(ROOT, "sitemap.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        f.write(f"  <url><loc>{u}</loc><lastmod>{UPDATED}</lastmod></url>\n")
    f.write("</urlset>\n")
print("sitemap:", len(urls))
