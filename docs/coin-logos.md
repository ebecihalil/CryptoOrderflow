# Coin logos

The application ships a compact identity catalog for thousands of cryptocurrencies.
Images load lazily from CoinMarketCap's public image CDN; verified matching legacy
icons can fall back to the cryptocurrency-icons repository and CoinCap.
No images are downloaded into Git.

Smaller tokens absent from the primary catalog also use verified Gate-hosted images.
These are matched to Gate's active currency metadata, and each image response is
checked for a successful image content type and non-empty payload before shipping
its URL. The initial supplementary catalog adds 241 verified exchange-hosted links.
Run `npm run update:gate-logos` manually to maintain this supplement; optionally
pass `-- --inventory /path/to/saved-market-snapshot.json` to restrict it to a
saved screener inventory. With no inventory or preview domain, it checks active
Gate currencies missing primary identities. CDN checks use three paced workers
and stop on HTTP 429. They do not run when a visitor opens or refreshes a page.

The catalog is assembled from public CoinMarketCap listings. Duplicate ticker
symbols are resolved only through explicit reviewed identities, a unique Binance
listing tag, or a unique full-name match from exchange metadata or the named legacy
icon catalog. Market-cap rank alone does not establish a token's identity.
Unresolved duplicates retain a neutral placeholder rather than an unrelated logo.

Coin logos are shared by Funding and LSAR. Multiplier-prefixed symbols and known
aliases resolve to underlying assets. Genuine names such as 1INCH are preserved.
Known equity, commodity and index contracts are not assigned cryptocurrency logos.
The logo resolver never changes funding, OI, price, or market grouping calculations.

Run `npm run update:coin-logos` manually to refresh the shipped metadata, then build
and redeploy. This operation is NOT run by startup, builds, Refresh buttons, or API
polling. Exchange name metadata uses the existing shared request gates. Catalog
request failures stop the update rather than silently replacing a catalog with
empty data. Optional exchange metadata failures are reported and unresolved
symbols remain ambiguous.

Explicit reviewed identities live in `src/data/coin-logo-overrides.json`.
Only add an identity after checking its actual project and exchange-listed token.
Failed image URLs are remembered for the current browser session to avoid
retrying the same broken image on every table render. Changing a row's asset
resets its image attempt state.

The logos belong to their respective projects; the catalogs and images remain
subject to their publishers' terms. The cryptocurrency-icons repository supplies
its own license. CDN/network failures can still exhaust the fallbacks, in which
case the neutral placeholder remains visible.
