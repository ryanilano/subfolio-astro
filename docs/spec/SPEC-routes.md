# SPEC-routes — URL Routes & Request Flow

Documenting the full URL scheme from Apache `.htaccess` rewrites through Kohana routing
to controller/action dispatch. This is the reference for building the Go `net/http` router.

---

## 1. Architecture Overview

```
Request → Apache (htaccess rewrites) → index.php → Kohana Router (routes.php) → Controller::action()
                                                                                        ↓
                                                                              Website_Controller
                                                                              (session, auth, access,
                                                                               filebrowser, filekind)
                                                                                    ↓
                                                                         Filebrowser_Controller
                                                                         (hash, login, logout,
                                                                          denied, notfound,
                                                                          access, index)
```

- **htaccess** rewrites clean URLs into `index.php/...` paths, blocks sensitive files.
- Kohana's **routes.php** maps named routes to `controller/action` pairs.
- `_default` route catches anything not explicitly named → `filebrowser/index`.
- `Website_Controller` (parent) wires up session, auth, access, filebrowser, filekind, template.
- `Filebrowser_Controller` handles all public-facing actions.

---

## 2. htaccess Rewrites & Web Blocks

Source: `htaccess:1-27` (RewriteBase `/engine/`)

### 2.1 Blocked paths (return 403 Forbidden)

| Pattern | Rule | Purpose |
|---------|------|---------|
| `config/settings` | `[F,L]` | Block config YAML from web |
| `config/users` | `[F,L]` | Block user credentials |
| `engine/application` | `[F,L]` | Block PHP source |
| `engine/modules` | `[F,L]` | Block module source |
| `engine/system` | `[F,L]` | Block Kohana system |
| `*.yml` | `[F,L]` | Block all YAML files |
| `htaccess` | `[F,L]` | Block this file itself |

### 2.2 Rewrite rules (in order of evaluation)

| # | URL Pattern | Rewrite Target | Flags | Purpose |
|---|------------|----------------|-------|---------|
| 1 | `^notfound$` | `index.php/notfound` | `[PT,L]` | Not-found page |
| 2 | `^denied$` | `index.php/denied` | `[PT,L]` | Access-denied page |
| 3 | `^hash/?(.*)$` | `index.php/hash/$1` | `[PT,L]` | Password hash tool |
| 4 | `^login$` | `index.php/login` | `[PT,L]` | Login form/handler |
| 5 | `^logout$` | `index.php/logout` | `[PT,L]` | Logout action |
| 6 | `^-cms$` | `index.php/cms/home/index` | `[QSA,PT,L]` | CMS dashboard home |
| 7 | `^-cms/(.*)$` | `index.php/cms/$1/index` | `[QSA,PT,L]` | CMS section index |
| 8 | `^-cms/(.*)/(.*)$` | `index.php/cms/$1/$2` | `[QSA,PT,L]` | CMS section/action |
| 9 | `^directory/(.*)$` | `index.php/filebrowser/access?path=$1` | `[QSA,PT,L]` | File serving (download/inline) |
| 10 | `.*` (not file/dir) | `index.php?path=$0` | `[QSA,PT,L]` | Directory listing (fallback) |
| 11 | `^$` | `index.php?path=` | `[QSA,PT,L]` | Root → listing |

**Key design notes:**
- `/directory/*` routes through the `access` action — this is the *file-serving* path, not the browsing path. It streams the raw file with correct Content-Type and optional `?download` query param for forced download.
- All other paths (including `/` and `/<anything>`) route through `index` with `path` as a GET parameter — this is the *directory browsing* path.
- CMS routes bypass `routes.php` entirely — they use Kohana's direct controller/action resolution from the URI segments (`cms/<section>/<action>`).
- Rule order matters: exact matches (`login`, `logout`, etc.) are checked before the `/directory/` and catch-all rules.

---

## 3. Kohana Route Table

Source: `routes.php:7-14`

| Route Key | Pattern | Controller::Action | Backreference |
|-----------|---------|--------------------|---------------|
| `login` | `login` | `filebrowser/login` | — |
| `logout` | `logout` | `filebrowser/logout` | — |
| `hash/?(.*)` | `hash[/<password>]` | `filebrowser/hash/$1` | `$1` = optional password |
| `denied` | `denied` | `filebrowser/denied` | — |
| `notfound` | `notfound` | `filebrowser/notfound` | — |
| `_default` | `*` | `filebrowser` (→ `index`) | — |

The `_default` route sends everything unmatched to `Filebrowser_Controller::index()`. The `path` is read from `$_GET['path']` (set by htaccess rule 10/11), not from a URL segment.

---

## 4. Complete Route → Behavior Table

This is the single table a Go router can be built from. Every URL the application handles:

| URL Pattern | Controller::Action | Method | Behavior | Returns |
|-------------|--------------------|--------|----------|---------|
| `/` | `Filebrowser::index` | GET | List root directory | HTML (listing view) |
| `/<path>` | `Filebrowser::index` | GET | List directory at `?path=<path>` | HTML (listing or single-file view) |
| `/directory/<path>` | `Filebrowser::access` | GET | Serve file at `?path=<path>`; check access first | Raw file (download or inline) |
| `/directory/<path>?download` | `Filebrowser::access` | GET | Force-download file at `?path=<path>` | Raw file (Content-Disposition: attachment) |
| `/login` | `Filebrowser::login` | GET | Show login form | HTML (login page) |
| `/login` | `Filebrowser::login` | POST | Process login (username+password) | 302 redirect to `return_path` or `/` |
| `/logout` | `Filebrowser::logout` | GET | Destroy session, logout | 302 redirect to `/` |
| `/hash` | `Filebrowser::hash` | GET | Show hashing instructions | Text/HTML |
| `/hash/<password>` | `Filebrowser::hash` | GET | Display bcrypt-like hash of `<password>` | Text/HTML |
| `/denied` | `Filebrowser::denied` | GET | Show "access denied" page | HTML (denied page) |
| `/notfound` | `Filebrowser::notfound` | GET | Show "not found" page | HTML (notfound page) |
| `/-cms` | `cms/home::index` | GET | CMS dashboard | HTML |
| `/-cms/<section>` | `cms/<section>::index` | GET | CMS section index | HTML |
| `/-cms/<section>/<action>` | `cms/<section>::<action>` | GET | CMS action | HTML |

---

## 5. Controller Action Details

### 5.1 `index()` — Directory listing / single-file view

Source: `filebrowser.php:142-237`

**Flow:**
1. Reads `$_GET['path']` (set by htaccess rule 10/11)
2. Calls `$this->filebrowser->set_path($path)`
3. Checks `$this->filebrowser->exists()` — if not, renders `pages/notfound`
4. Loads access rules via `$this->access->load_access(...)`
5. If access is restricted and user not logged in → redirect to `/login` (saving `return_path`)
6. If access denied → render `pages/denied`
7. If access granted:
   - If the path is a **single file** → render `pages/filekinds/<kind>` (falls back to `pages/filekinds/default`)
   - If the path is a **folder** → render `pages/listing`
   - Special cases: `site` and `oplx` folders treated as single items; `slide` folder redirects to first file

**Template variables set:**
- `$this->template->page_title` — display title derived from path
- `$this->template->page_class` — `"page--detail"` for single files, `"page--browser"` for listings
- `$this->template->content` — the view object

### 5.2 `access($path='')` — File serving

Source: `filebrowser.php:78-140`

**Flow:**
1. Reads `$_GET['path']` (set by htaccess rule 9)
2. Sets path on filebrowser, loads access rules
3. If restricted and not logged in → redirect to `/login`
4. If access denied → redirect to `/denied`
5. If access granted:
   - Serves the raw file with correct `Content-Type` (via `mime_content_type()` lookup table)
   - If `$_GET['download']` is set → forces download (`Content-Disposition: attachment`)
   - Sets caching headers (`Expires`, `Cache-Control`, `Pragma`, `Content-Length`)
   - Streams file in 4096-byte chunks
6. Special case: if folder has `.oplx` extension → creates and downloads a ZIP archive

### 5.3 `login()` — Login form & handler

Source: `filebrowser.php:14-56`

**Flow:**
- If already logged in → redirect to `return_path` (from session) or `/`
- GET: renders `pages/login` view
- POST: validates username + password, calls `$this->auth->login(username, password, true)`
  - Success → flash message + redirect to `return_path`
  - Failure → re-render login with `login_failed = true`

### 5.4 `logout()` — Logout

Source: `filebrowser.php:58-63`

**Flow:**
1. Calls `$this->auth->logout(true)` — destroys auth session
2. Creates new session
3. Flash message "logout complete"
4. Redirects to `/`

### 5.5 `hash($password=null)` — Password hashing tool

Source: `filebrowser.php:4-12`

**Flow:**
- No password → shows instructions for using the hash tool
- With password → displays `$this->auth->hash($password)` result
- Always calls `exit()` — no template rendered, plain text output

### 5.6 `denied()` — Access denied page

Source: `filebrowser.php:66-70`

- Renders `pages/denied` view
- Sets `page_class = "page page--denied"`

### 5.7 `notfound()` — Not found page

Source: `filebrowser.php:72-76`

- Renders `pages/notfound` view
- Sets `page_class = "page page--notfound"`

---

## 6. Access-Control Flow (reused by index & access)

Both `index()` and `access()` follow the same access-check pattern:

```
1. Load access rules for current folder (walks up tree, inherits from parents)
2. If folder is_restricted():
   a. If user NOT logged_in() → save return_path in session → redirect /login
   b. (If logged in, fall through to check_access)
3. If check_access(user) passes → serve content
4. If check_access fails → show /denied (or redirect for access action)
```

This is the middleware chain for the Go port — an `AccessMiddleware` that runs before both the listing handler and the file-serving handler.

---

## 7. Go Router Blueprint

Based on this analysis, the Go router should handle these distinct patterns:

```go
// Static routes (exact match, highest priority)
mux.HandleFunc("GET /login",    handleLogin)
mux.HandleFunc("POST /login",   handleLoginPost)
mux.HandleFunc("GET /logout",   handleLogout)
mux.HandleFunc("GET /hash",     handleHash)          // shows instructions
mux.HandleFunc("GET /hash/{pw}", handleHashPassword)  // shows hashed password
mux.HandleFunc("GET /denied",   handleDenied)
mux.HandleFunc("GET /notfound", handleNotFound)

// CMS routes (under /-cms/)
mux.HandleFunc("GET /-cms",              handleCMSHome)
mux.HandleFunc("GET /-cms/{section}",    handleCMSSection)
mux.HandleFunc("GET /-cms/{section}/{action}", handleCMSAction)

// File-serving route (with access middleware)
mux.HandleFunc("GET /directory/{path...}", chain(
    accessMiddleware,
    handleFileServe,
))

// Directory listing (catch-all, with access middleware)
mux.HandleFunc("GET /{path...}", chain(
    accessMiddleware,
    handleListing,
))
```

**Key routing decisions:**
- `/directory/*` must be registered *before* the catch-all `/{path...}` to avoid the catch-all swallowing file-serve requests.
- The root `/` is handled by `GET /{path...}` with `path=""`.
- Access middleware is shared between file-serving and listing — same logic, different final handler.
- The `hash` route is the only one that bypasses the template system (returns plain text with `exit()`).

---

## 8. Security Notes

### 8.1 Web-blocked paths (htaccess → Go equivalent)

The Go port must replicate these blocks as middleware or handler checks:

| Blocked | Reason |
|---------|--------|
| `config/settings/*` | Settings YAML must not be served |
| `config/users/*` | User credentials must not be served |
| `*.yml` | All YAML files blocked from direct access |
| `engine/*` | PHP source (not applicable in Go, but keep the block for legacy) |
| `htaccess` | This file itself |

In Go, this is most naturally a middleware that checks the resolved file path against these patterns before serving, or simply root-jailing the file server so it cannot escape the content directories.

### 8.2 Hash route

The `/hash/<password>` route currently exposes the hash in plain text to anyone who visits the URL. In the Go port, this should be replaced by the `subfolio hashpw` CLI subcommand (see D1 task), keeping password hashing off the web surface entirely.
