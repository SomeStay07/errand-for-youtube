# English listing

Name, Chrome/Opera (extName, 55/75): Errand for YouTube: Hide Shorts, Feed & Recommendations
Name, Edge/Firefox (extNameShort, 38/45): Errand for YouTube: Hide Shorts & Feed
Summary (extDescription, 126/132): YouTube always has one more video for you. Errand hides Shorts and the feed and offers to close the tab when yours ends. Free.

## Description (paste below this line)

That's how one tutorial takes the whole evening. Like an errand: you go for one video and leave once you have it. It's a distraction-free YouTube extension. Free and open source, and you don't need an account. If you only want Shorts gone, pick "Just hide Shorts" on the first screen: the feed, recommendations, comments, autoplay and the end screen stay as they were.

When your video ends, autoplay is off unless it's a playlist. The end screen and end cards stay hidden, and so does the "More videos" grid in fullscreen. Errand asks "Got what you came for?" and offers Close tab.

What changes

• Home shows one question instead of the feed. Type the answer and you land on search results. Home can also open Watch later, the usual feed or Subscriptions (there without the "Most relevant" shelf).
• Shorts disappear from home, search, subscriptions, channel pages and the sidebar. Their links open in the normal player, or don't open at all if you choose that.
• Video pages have no recommendations column. If you need it, press "Show recommendations" and wait 10 seconds. Comments open with a "Show comments" button.
• If you typed what you came for, "Back to results" at the end takes you back to your search. Playlists play on as usual.
• With the default look, Mixes, the suggestions under an empty search box and recommendation shelves inside search results are hidden too. The menu can also hide live chat, the notification bell and view, like and subscriber counts, or dim thumbnails until you hover.
• Strict mode runs on a schedule, say weekdays 9 to 6, and removes the "show" buttons for those hours.
• "Pause 15 min" turns everything off after a 10-second wait and comes back on by itself. Strict mode has no pause. Turning it off also takes a 10-second wait, and on a schedule it stays off only until those hours end.
• The menu shows how many errands you finished in the last 7 days.

If YouTube changes something, you'll know

Extensions like this usually break the same way. The layout changes, hidden things creep back, and the one-star reviews say "stopped working after an update". On home, search and video pages Errand checks that it still finds what it hides and that no Shorts slipped through. If something changed, the icon shows "!" and the menu says what stopped working. Every breakage goes into a public log with the date it was found, fixed and live in the store: https://somestay07.github.io/errand-for-youtube/breakage/

The ad-blocker warning usually appears when requests or ads get blocked. Errand blocks neither: it hides parts of the page and adds a few buttons of its own. Shorts, the feed and recommendations are hidden before the page draws, so they don't flash. One exception: with YouTube in some languages, like Japanese, their tab on channel pages and the search chip can show for a moment.

Privacy

Settings and stats stay in your browser. The extension makes no network requests, and there's no AI in it. Permissions: access to www.youtube.com, to hide things there, and storage, to remember your settings. Nothing else.

Code: https://github.com/SomeStay07/errand-for-youtube

Questions

Does it block ads? No. Use uBlock Origin for that; they work fine together.
Do I need to sign in? No.
[Chrome Web Store only] Brave, Vivaldi, Yandex Browser? Install it from the Chrome Web Store.
[Chrome Web Store only] Install stuck, or a safety warning? Enhanced Safe Browsing doesn't list Errand yet, so Chrome asks you to confirm. If the install just spins, as in Arc, switch to Standard protection (Settings > Privacy and security > Security), install, then switch back.
Phone? Not yet.
Something leaked through? Open an issue on GitHub with a screenshot. Fixes after updates are what I work on first.

YouTube is a trademark of Google LLC. Errand is not affiliated with or endorsed by Google.
