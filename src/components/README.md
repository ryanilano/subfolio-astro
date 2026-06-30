# Component prop contract — Phase 2

Every Wave task produces one `.astro` component. This doc is the binding prop
contract — it defines the data shape a component receives, where helpers live,
and the pattern to follow. Read this BEFORE porting a view. If a component
needs something not covered here, bring it back to the Gate.

## Data shapes

The single source of truth for types is [src/loaders/schema.ts](../loaders/schema.ts).
Filekind components receive a **`FileViewData`** (from [src/lib/fileHelpers.ts](../lib/fileHelpers.ts))
which is a `ChildFile` + computed per-field extras that replicate what
`Subfolio::current_file()` returned in PHP:

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Original disk name |
| `displayName` | `string` | Sanitized display name |
| `ext` | `string` | Lowercased extension |
| `kind` | `string` | Filekind key (img, vid, pdf, …) |
| `icon` | `string` | Raw icon name (e.g. `"img"`) |
| `display` | `string` | Human kind label from filekinds.yml |
| `enhancer` | `string \| null` | File enhancer (link, pop, ftr, rss) if any |
| `linkPayload?` | `{ url, target, comment? }` | Parsed .link YAML |
| `popupPayload?` | `{ url, width, height, name, style, comment? }` | Parsed .pop YAML |
| `width` | `number` | Phase 3 sharp, currently 0 |
| `height` | `number` | Phase 3 sharp, currently 0 |
| `iconGrid` | `string` | `"grid_"` + icon (e.g. `"grid_img"`) |
| `iconName` | `string` | Raw icon name |
| `tag` | `string` | `"new"` or `""` |
| `url` | `string` | File URL relative to content root |
| `link` | `string` | Resolved link (enhancer-resolved or `url`) |
| `target` | `string` | Link target (`_blank` / `_self`) |
| `filename` | `string` | Display filename |
| `lastmodified` | `string` | Formatted date `"M D, Y – H:MM"` |
| `size` | `string` | Formatted size `"1.5 MB"` |
| `rawsize` | `number` | Bytes on disk |
| `comment` | `string` | Enhancer comment |
| `kindLabel` | `string` | Human label from filekinds.yml |
| `extension` | `string` | Extension truncated to 3 if >6 chars |
| `instructions` | `string` | Filekind instructions HTML |
| `body` | `string` | Raw file body (txt views), deferred Phase 5 |
| `archive` | `string` | Zippable archive path (oplx) |

Listing components receive the full **`FolderEntry`** from schema.ts.

## Helper libraries

- **`src/lib/fileHelpers.ts`** — `buildFileViewData(file: ChildFile, ctx): FileViewData`
- **`src/lib/i18n.ts`** — `t(key: string): string` — replaces `SubfolioLanguage::get_text()`
- **`src/lib/site.ts`** — `siteConfig` (settings), `defaultOptions` (display toggles)

## Filekind component pattern

Follow `src/components/filekinds/Img.astro` exactly:

```astro
---
import type { FileViewData } from "../../lib/fileHelpers.ts";

interface Props {
  file: FileViewData;
}

const f = Astro.props.file;
---
<!-- markup with PHP classes preserved -->
```

- **Prop name is `file`** — always.
- **Import style:** relative paths from the component's directory.
- **Markup:** keep CSS classes and HTML structure **identical** to the PHP source
  so visual diffing works. Port the logic, don't redesign.
- **Filenames are PascalCase** (e.g. `Vid.astro`, `Snd.astro`) — matching the
  reference `Img.astro` and the output names in the task table.

## Where to read the PHP source

Upstream theme views live at:
`/Users/ryan/local-dev/subfolio/config/themes/default/pages/`

Output filenames are PascalCase (`<Kind>.astro`), even though the PHP sources are
lowercase.

| View type | Source dir | Output dir |
|---|---|---|
| Filekind | `…/pages/filekinds/<kind>.php` | `src/components/filekinds/<Kind>.astro` |
| Listing | `…/pages/listing/<name>.php` | `src/components/listing/<Name>.astro` |
| Partials | `…/pages/filekinds/_<name>.php` | `src/components/filekinds/<Name>.astro` |
