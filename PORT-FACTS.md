# PORT-FACTS

Single source of truth for every factual claim the port makes about the original Subfolio.

The docs site and the ilano.fyi case study should cite this file rather than restating its numbers. When a fact changes, it changes here.

Verified 2026-07-26.

## The upstream pin

Every "before" claim below describes one specific commit of a public repository:

| | |
|---|---|
| Repo | `area17/subfolio` |
| Commit | `ec8889e670d5da07159a2e5841e80f964248e610` |
| Date | 2021-04-16 18:08:02 +0200 |
| Subject | Fix issue with the Filebrowser : array_pop is expecting a variable |
| Branch | `master` |

This is the last commit `master` received. The project is public and unarchived, so the claims stay checkable.

### Trap when verifying locally

`~/local-dev/subfolio` is **`ryanilano/subfolio`**, a fork — not `area17/subfolio`. Its `master` HEAD is `321e4295`, a June 2026 modernization commit written by Ryan. Reading line numbers from that checkout's HEAD gives figures that do not match the pin.

Always address the commit explicitly:

```bash
git show ec8889e670d5da07159a2e5841e80f964248e610:engine/application/libraries/Auth.php
```

## Security claims

All line numbers are at `ec8889e`, verified by reading the file at that commit.

### MD5 password hashing

`engine/application/libraries/Auth.php:176-179`

```php
public function hash($str) {
  $salt = Kohana::config('filebrowser.auth_salt');
  return md5($salt.$str);
}
```

### A committed, global salt

`engine/application/config/filebrowser.php:40`, with the comment at line 37:

```php
// NOTE IF YOU CHANGE THIS YOU WILL NEED TO REGENERATE YOUR HASHED PASSWORD LIST

$config['auth_salt']    = 'W8Kivk5ykGhSrc11';
```

One global value, committed as a literal. Identical passwords therefore produce identical hashes, and the comment records that rotating it invalidates every stored hash.

### The `sha1` trap — do not write SHA-1

`engine/application/config/auth.php:29`

```php
$config['hash_method'] = 'sha1';
```

This is inherited Kohana config that the custom `Auth::hash()` never reads. The function hardcodes `md5()`. Anyone skimming `auth.php` alone will challenge the MD5 claim, so state the two together. **The algorithm in use is MD5. Never describe the original as SHA-1.**

### Two password paths, one plaintext

`engine/application/libraries/Auth.php:113` defines `login()`, which branches on whether the user has a hashed password:

- `:124-126` — hashed path, compares `$user->hashed_password === $hashed`
- `:138-139` — **plaintext path**, compares `$user->password === $password` directly

```php
} else {
  if ($user->password === $password) {
```

Both branches are real. A claim that `login()` compares plaintext directly is accurate for the second branch; a claim that it compares MD5 hashes is accurate for the first. State which one, or state both.

### Path traversal

The raw query parameter is read in the controller at `engine/application/controllers/filebrowser.php:79` and again at `:143`:

```php
$path = isset($_GET['path']) ? $_GET['path'] : '';
```

and concatenated onto the configured root, without sanitization, in the library at `engine/application/libraries/Filebrowser.php:179`:

```php
$fullpath = $this->config['directory']."/".$path;
```

The case study's `Filebrowser.php:179` reference is correct and points at the concatenation. If the reference is ever expanded, the controller read is the other half.

The port does not patch this. A static build resolves paths at build time, so no runtime `?path=` exists and there is nothing to traverse.

## Stack end-of-life

**Not verified from the repository** — these are public facts about PHP and Kohana, carried from the case study research. They are recorded here so the docs and the case study cite one copy.

- PHP 5.6 reached end of life 2018-12-31.
- Kohana was retired 2017-07-01; its last stable release shipped July 2016.
- Kohana 2.x cannot run on PHP 8, which is why an in-place PHP upgrade was never an option.

## The port

| | |
|---|---|
| Repo | `ryanilano/subfolio-astro` |
| License | AGPL-3.0-or-later, inherited from upstream |
| Astro | `^6.4.2` (`package.json`) |

Attribution and the upstream pin both live in `README.md:49`.

### Measured results

From `docs/ROADMAP.md:88-96`. These are the port's own measurements, not upstream claims:

| | Before | After |
|---|---|---|
| Fonts | 906.5 KB, 5 formats | 47.3 KB, Inter variable woff2 |
| CSS | 93.5 KB | 84.4 KB minified |
| JS | 219.7 KB render-blocking | deferred |
| Thumbnails | PNG / JPEG | WebP / AVIF, −64% to −93% |
| Head | title only | OG + Twitter + canonical |
| HTML (max page) | 13.4 KB | 13.5 KB, within a 20 KB budget |

## First-person claims with no document behind them

Recorded so nobody mistakes them for sourced facts:

- The 2016 exploit against Ryan's own installation, and Dreamhost's response telling him to upgrade the engine or stop running it on the open internet. No server logs survive; every subfolio repo and all of `~/local-dev` were searched. This is testimony, and it should stay first-person wherever it appears.
