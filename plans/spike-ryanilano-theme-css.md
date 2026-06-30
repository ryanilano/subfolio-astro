# Spike: port the ryanilano theme CSS (deferred)

**Status:** SPIKE / deferred. Out of scope for the settings.yml config task
([fluffy-noodling-goblet.md](fluffy-noodling-goblet.md)). Captured so it isn't lost.

## The finding

The Astro port ships the **default** AREA17 theme — `src/styles/main.scss` is headed
*"Subfolio by AREA 17"*, the modernized-into-SCSS form of the stock default `main.css`.
The live ryanilano.com look lived in a **customized** theme CSS that was never ported.

Two files in `config-legacy/themes/ryanilano/` make the delta exact:

- `css copy/main.css` (21,825 B) = **pristine default backup** (byte-size-identical to
  `config-legacy/themes/default/css/main.css`) — snapshotted before customizing.
- `css/main.css` (25,344 B) = the **customized ryanilano** theme.

`diff "css copy/main.css" css/main.css` ≈ **346 lines = the entire ryanilano theme**.
It's a bounded override layer on the same default base the port already compiles, NOT a
rewrite.

## What ryanilano actually overrides (the substantive deltas)

- Page background `#ececec` (vs white); base font `10px`; Helvetica-Neue-first stack.
- Fixed `#container { width: 980px }` / `max-width: 1024px` (vs fluid ~970px).
- `#logo { padding-left: 1.6em }`; `#gallery { max-width: 70em }`.
- **Dark gallery tiles** — thumbnail bg `#333`, `.grid li a:hover` bg `#000` (default is
  light `#f5f5f5`/white). Most visible identity change.
- Drops default cruft: iOS tap-highlight, `hr`, `.columns4`, the CMS `ul.group` block,
  the `width:700px` `.standard_paragraph` constraints.

## Proposed approach (when picked up)

1. **SCSS-overrides route, not the flat file.** Build a `theme=ryanilano` layer carrying
   only these ~20 real changes on top of the A17 base — cleaner than dragging in the 2014
   flat CSS with its IE6/iphone bits.
2. **New capability needed:** the `theme:` / `options.yml` mechanism does NOT load any
   stylesheet today — only toggles/values. This adds a "serve + `<link>` the active
   theme's CSS" step to `Layout.astro`.
3. **Selector caveat — verify each against the port's rendered DOM.** The deltas target
   legacy PHP markup (`#container`, `#gallery ul li a div.gallery_thumbnail`,
   `.grid li a:hover`, `#logo`, `.standard_paragraph`). Some survive in the port; some
   were renamed to A17 BEM (`.list__cell--filename`, …). The diff is the *spec*; confirm
   selectors still match.
4. **Overlap to reconcile with `color_palette`.** `Layout.astro` already emits inline
   `colorCss` from `src/config/colors-<name>.yml` for `body` + `#gallery … .gallery_thumbnail`
   backgrounds. ryanilano's dark-tile choice partly collides with that — decide whether
   dark tiles come from a new color palette or the theme CSS layer.

Related to the "+assets" tier (serving theme logo/favicon/color images), also deferred.
