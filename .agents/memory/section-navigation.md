---
name: Consistent section navigation
description: User requirement for matching Home buttons throughout Crypto Order Flow.
---
Use the same complete header on LSAR, Funding Rate and the other section pages,
not merely an identical Home button. Keep the right-side controls in the same
order: Home, section badge, Market Feed, theme toggle.

**Why:** the user noticed that LSAR and Funding had different Home buttons and
explicitly requested that all pages use the same button. They subsequently
clarified that differing placement and a missing Market Feed indicator made
the pages look like different websites.

**How to apply:** preserve matching header layout, branding size, spacing,
status visibility and responsive behavior when building additional order-flow
sections, rather than introducing section-specific variants.

Long Short Account Ratio is a direct top-level module, with no Long Short
Position Ratio subsection or department dropdown.

**Why:** the user explicitly requested removal of Position Ratio and renaming
the main-page Long Short Ratio item to Long Short Account Ratio, with no
subsections in that department.

**How to apply:** link directly to the existing account-ratio screener and keep
this naming consistent in its header/navigation; do not restore the former
account/position menu when expanding other order-flow sections.

Keep CVD and Liquidations off the main page; place Super Charts (Indicators)
in the middle of the second row.

**Why:** the user explicitly requested removing those two main-page items and
specified the Super Charts placement.

**How to apply:** treat this as a main-page navigation/layout change, not
permission to delete related data or functionality. Preserve responsive
stacking on narrow screens.
