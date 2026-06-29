# Subfolio-Astro Changelog

Modernized pipeline (was: grunt svgcss + hand-encoded autoprefixer "last 5 versions"):

- SVGs are optimized with SVGO (drops Illustrator cruft, shortens paths) and embedded with mini-svg-data-uri's minimal escaping. This is far smaller than the old `charset=US-ASCII` + full encodeURIComponent() form, pixel-identical rendering.
- Vendor prefixing targets come from a single `browserslist` query (package.json "browserslist": ["defaults"]) via lightningcss's browserslistToTargets()... no more hand-encoded version ints, and IE/dead-browser prefixes are gone.
