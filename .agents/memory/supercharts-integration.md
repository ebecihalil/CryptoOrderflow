---
name: Super Charts integration
description: Approved technical versus custom orderflow scope and hosted-widget limitations.
---

Keep Super Charts split into Technical Indicators and Orderflow Indicators.
The first uses TradingView's official hosted widget; the second hosts our custom
exchange-data indicators, starting with the approved Liquidity Zones adaptation.

**Why:** the user approved launching standard TradingView charts first, with a
separate area for custom exchange-data indicators. They subsequently supplied
Liquidity Zones and approved adding it with its existing rules.

**How to apply:** preserve supplied indicator semantics rather than silently
"improving" them. Do not invent additional formulas or fake orderflow charts.
The hosted widget cannot consume our custom exchange data; use a separate chart
library or approved Advanced Charts access for that future work. Do not treat
TradingView's chart-control APIs as downloadable market-data APIs.

The official embed script changes its container's inline height to 100%.

**Why:** that override collapsed a visually reserved tall chart to the browser's
default 150px iframe because percentage height had no definite parent height.

**How to apply:** preserve a definite responsive container height that takes
precedence over the injected inline value. An iframe load event alone does not
prove quotes are available; keep loading/error descriptions truthful.

Pending TradingView scripts can execute even after being removed from the DOM.

**Why:** rapid indicator changes produced errors when a late script found that
its parent had been removed individually.

**How to apply:** isolate each embed in its own container, debounce insertion
and detach the entire subtree during cleanup so pending scripts retain their
parent. Do not reuse the same inner container for successive configurations.
