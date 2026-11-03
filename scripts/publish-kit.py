import html
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
LANGS = [("en", "English"), ("ru", "Русский"), ("es", "Español"), ("pt_BR", "Português (Brasil)"), ("de", "Deutsch")]
SITE = "https://somestay07.github.io/errand-for-youtube/"
GH = "https://github.com/SomeStay07/errand-for-youtube"
PRIVACY = f"{GH}/blob/main/PRIVACY.md"
SINGLE = "Errand reduces distraction on youtube.com. It hides Shorts, the home feed, recommendations and end-screen suggestions, replaces the home page with a \"What are you here for?\" search box, and offers to close the tab when a video ends. All features act only on www.youtube.com pages."
STORAGE = "Saves the user's settings, the optional goal typed on the home page (deleted after 3 hours), weekly counts of errands, a pause end time and a short local log of filters that stopped working, in local extension storage. Nothing is transmitted."
HOST = "The content script and CSS must run on YouTube pages to hide Shorts, the feed, recommendations and comments before the page draws, to add the extension's own buttons (show recommendations, close tab), and to check that its filters still match YouTube's layout. It runs on no other site; embeds are excluded."


def description(loc):
    text = open(os.path.join(ROOT, "store", "listing", f"{loc}.md")).read()
    body = re.split(r"\n## [^\n]*\n", text, maxsplit=1)[1].strip()
    return re.sub(r"\[[^\]]*\]\s*", "", body)


fields = []


def card(title, value):
    i = len(fields)
    fields.append(i)
    rows = min(18, max(2, value.count("\n") + 2))
    return f'<div class="f"><div class="h"><b>{html.escape(title)}</b><button data-i="{i}">Скопировать</button></div><textarea id="t{i}" readonly rows="{rows}">{html.escape(value)}</textarea></div>'


parts = [f'<h2>1. Пакет</h2><p>Новый элемент или новая версия → загрузить <code>dist/errand-chrome-&lt;версия&gt;.zip</code>. Название и краткое описание подтягиваются из пакета.</p>',
         '<h2>2. Описание по языкам</h2>']
for loc, name in LANGS:
    parts.append(f"<h3>{name}</h3>" + card(f"Описание: {name}", description(loc)) + f'<p class="n">Картинки: <code>store/images/{loc}/</code></p>')
parts.append("<h2>3. Общие поля</h2>" + card("Официальный сайт / главная", SITE) + card("URL поддержки", f"{GH}/issues"))
parts.append("<h2>4. Конфиденциальность</h2>" + card("Единственная цель", SINGLE) + card("Обоснование: storage", STORAGE) + card("Обоснование: доступ к хосту", HOST) + card("URL политики", PRIVACY))
parts.append("<p>Удалённый код: Нет. Данные: ни одной категории. Все три галочки.</p><h2>5. Распространение</h2><p>Бесплатно · Общедоступно · Все регионы.</p>")

page = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Errand. Публикация в Chrome Web Store</title>
<style>body{{font:15px/1.5 -apple-system,Arial,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#16302b;background:#f7f3ea}}h2{{margin-top:32px;border-top:1px solid #ddd5c4;padding-top:16px}}.f{{background:#fff;border:1px solid #ddd5c4;border-radius:10px;padding:10px 12px;margin:10px 0}}.h{{display:flex;justify-content:space-between;align-items:center;gap:12px}}textarea{{width:100%;box-sizing:border-box;margin-top:8px;font:13px/1.45 ui-monospace,Menlo,monospace;border:1px solid #e5dfd2;border-radius:6px;padding:8px}}button{{background:#16302b;color:#f4ebd9;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit}}button.ok{{background:#f2a541;color:#16302b}}.n{{color:#4d5f5a;font-size:13px}}code{{background:#fff;border:1px solid #e5dfd2;border-radius:6px;padding:1px 6px}}</style></head>
<body><h1>Errand. Публикация в Chrome Web Store</h1><p>Сгенерировано из <code>store/listing/*.md</code> скриптом <code>scripts/publish-kit.py</code>. Не править руками.</p>
{"".join(parts)}
<script>document.querySelectorAll("button[data-i]").forEach(b=>b.onclick=async()=>{{const t=document.getElementById("t"+b.dataset.i);try{{await navigator.clipboard.writeText(t.value)}}catch{{t.select();document.execCommand("copy")}}b.textContent="Скопировано";b.classList.add("ok");setTimeout(()=>{{b.textContent="Скопировать";b.classList.remove("ok")}},1500)}})</script></body></html>"""
open(os.path.join(ROOT, "store", "publish-chrome.html"), "w").write(page)
print("store/publish-chrome.html:", len(fields), "fields")
