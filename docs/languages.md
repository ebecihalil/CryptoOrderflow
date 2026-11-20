# Languages

The header has a language menu (flag + code) left of "Market feed". 22
languages: English, Turkish, Hindi, Russian, Greek, Chinese, Spanish,
Portuguese, French, German, Italian, Japanese, Korean, Vietnamese,
Indonesian, Filipino, Thai, Arabic, Urdu, Ukrainian, Polish and Dutch.

- The choice is saved in the browser (`cof:v1:language`); first visits follow
  the browser language when it is offered, otherwise English.
- Translated: header, home page and module names, sign up / sign in, the
  watchlist panel, recent coins and the timeframe menu. Chart, table and
  indicator labels stay in English.
- Text lives in `src/lib/i18n-keys.js` (English source) and
  `src/lib/i18n-text.js` (one line per key per language);
  `server/i18n.test.js` checks every language lines up with the keys.
- Flags are SVGs from `flag-icons` (MIT), so they show on Windows too.
