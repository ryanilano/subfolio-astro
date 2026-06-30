# SPEC-access — Access-Control Semantics

Porting target. Extracted from `engine/application/libraries/Access.php` (commit fbe9120),
`engine/application/controllers/filebrowser.php` (access action), and
`engine/application/libraries/FileFolder.php` (per-item gating).

---

## 1. The `-access` file

### 1.1 Location & naming

The access file is named `-access` by default (config key `filebrowser.access_file` in
`engine/application/config/filebrowser.php:16`).  If `-access` does not exist but
`-access.txt` does exist, the `.txt` variant is used instead.  The filename can be
overridden in `settings.yml` via the `access_file` key (`filebrowser.php:81`).

Access files may appear at **any directory level** within the content tree.

### 1.2 Grammar (YAML)

```yaml
# Top-level keys — apply to this folder and all descendants (subject to inheritance, §2)
allow_users:  [user1, user2, ...]    # list of usernames
allow_groups: [group1, group2, ...]  # list of group names
deny_users:   [user1, user2, ...]    # list of usernames
deny_groups:  [group1, group2, ...]  # list of group names

# Scoped to this folder only — does NOT inherit to descendants
current_folder:
  allow_users:  [user1, user2, ...]
  allow_groups: [group1, group2, ...]
  # deny_users and deny_groups are documented in the sample file (§1.3) but
  # the PHP that would process them is commented out (§3.2, lines 224-232).
  # deny_users:  [user1, ...]   ← NOT ACTIVE
  # deny_groups: [group1, ...]  ← NOT ACTIVE
```

- All keys are **optional**. An empty `-access` file (or one with no recognised keys) has
  no effect.
- Values are YAML lists of strings.
- The file is parsed with Spyc (`Spyc::YAMLLoad`).

### 1.3 Concrete example

From `directory/examples/07_protecting_a_folder/-access`:

```yaml
# YAML NOTE: Indentation, spacing and text case are super important.
# This file must be encoded as Unicode (UTF-8) for it to work properly.

# Note: Users and groups have to be created first in your settings before this will work.

allow_users: [username, username, etc]
allow_groups: [groupname, groupname, etc]
deny_users: [username, username, etc]
deny_groups: [groupname, groupname, etc]
Does not apply to sub-folders:

current_folder:
  allow_users: [username, username, etc]
  allow_groups: [groupname, groupname, etc]
  deny_users: [username, username, etc]
  deny_groups: [groupname, groupname, etc]
```

**Caveat:** The `deny_users` and `deny_groups` keys under `current_folder` appear in the
sample file but the PHP code that processes them is commented out
(`Access.php:224-232`). They have **no effect**. Only `current_folder.allow_users` and
`current_folder.allow_groups` are active.

> **Go port note:** When reimplementing, decide whether to activate
> `current_folder` denies (they are a reasonable feature) or to drop them from the spec
> to match legacy behaviour exactly. The decision should be recorded in an ADR.

---

## 2. Inheritance — walking the folder tree

When access is resolved for a path (e.g. `/projects/secret/nested/deeply/`), the system
walks **up** from that folder to the site root, collecting every `-access` file it finds.

There are two call paths:

### 2.1 Controller path (`$checking_child = false`)

Called from `Filebrowser_Controller::access()` (`filebrowser.php:82`):

1. Check the **current working directory** (the PHP process CWD) for `-access` /
   `-access.txt`.
2. Walk **up** from the requested folder through each ancestor directory to the site
   root, collecting `-access` files at each level.
3. Also check the **site root** itself.

### 2.2 FileFolder path (`$checking_child = true`)

Called from `FileFolder::load_access()` (`FileFolder.php:38`) for individual
items (files/folders):

1. Start from the **folder containing the item** (not CWD).
2. Walk up through ancestors to the site root, same as above.

The practical difference: the controller path checks one extra location (CWD), which is
relevant when the app is deployed with the working directory inside the content tree.

### 2.3 Collection order & reversal

Files are found in **descending** order (deepest folder → root). The list is then
**reversed** so that root-level files come first and the file closest to the requested
folder comes last (`Access.php:96`). This means:

> **Closer files override farther files.** A `-access` file in
> `/projects/secret/nested/` can override a `-access` file in `/projects/`.

### 2.4 The `current` marker

The last file in the reversed list — the one closest to the requested folder — is marked
as `$current`. Its `current_folder` keys (§1.2) are scoped to that folder only and do
**not** inherit to descendants.

---

## 3. Rule loading — allow/deny precedence

### 3.1 Per-file processing (`load_access_file`, line 176)

For each `-access` file, in order (root → closest):

1. **`allow_users`** → for each user, call `allow_user(user)`
2. **`allow_groups`** → for each group, call `allow_group(group)`
3. **`deny_users`** → for each user, call `deny_user(user)`
4. **`deny_groups`** → for each group, call `deny_group(group)`
5. If this is the `$current` file:
   - Process `current_folder.allow_users` → calls `current_allow_user(user)`
   - Process `current_folder.allow_groups` → calls `current_allow_group(group)`
   - (`current_folder` denies are **commented out**, lines 224-232)

### 3.2 Allow/deny state machine

The `Access` object maintains four accumulators across all loaded files:

| Property | Type | Purpose |
|---|---|---|
| `allowed_users` | `array[name=>name]` | Users explicitly allowed |
| `allowed_groups` | `array[name=>name]` | Groups explicitly allowed |
| `denied_users` | `array[name=>name]` | Users explicitly denied |
| `denied_groups` | `array[name=>name]` | Groups explicitly denied |
| `current_allowed_users` | `array[name=>name]` | Folder-scoped user allows |
| `current_allowed_groups` | `array[name=>name]` | Folder-scoped group allows |

Mutations (called per rule):

```
allow_user(user):
    if user in denied_users → remove from denied_users    // allow beats prior deny
    add user to allowed_users

deny_user(user):
    if user in allowed_users → remove from allowed_users  // deny beats prior allow
    add user to denied_users

allow_group(group):   same pattern as allow_user
deny_group(group):    same pattern as deny_user
```

**Key rule:** The last write wins. Since `allow` removes the entry from the deny set
(and vice versa), within a single file the order is `allow_users → allow_groups →
deny_users → deny_groups`, so **denies within a file override allows within the same
file**. Across files, since closer files are loaded later, **closer files override
farther files**.

### 3.3 `is_restricted` flag

If **any** `-access` file is found anywhere in the tree, `is_restricted` is set to
`true`. This flag controls whether access checks are enforced at all (§4).

---

## 4. Access check algorithm (`check_access`, line 115)

Input: a `User` object (or `null`). Output: `bool`.

### Step-by-step

1. **Admin bypass.** If `$user` is not null and `$user->admin` is truthy → **allow**
   (return `true`).  Admins see everything regardless of `-access` files.

2. **Unrestricted check.** If `$this->is_restricted` is `false` (no `-access` file was
   found anywhere in the tree) → **allow** (return `true`).

3. **Restricted — evaluate allows:**
   a. If `$user` is not null:
      - If `$user->name` exists in `$this->allowed_users` → set `$have_access = true`.
      - Else: intersect `$user->get_groups()` with `$this->allowed_groups`. If the
        intersection is non-empty → set `$have_access = true`.

4. **Restricted — if allowed so far, evaluate denies:**
   a. If `$have_access` is `true`:
      - If `$user->name` exists in `$this->denied_users` → set `$have_access = false`.
      - Else: intersect `$user->get_groups()` with `$this->denied_groups`. If the
        intersection has **more than 1 element** → set `$have_access = false`.
        > ⚠️ **Likely bug** (lines 146-155): the condition `sizeof($by_groups) > 1`
        > means a user who is a member of **exactly one** denied group is NOT denied.
        > The `array_diff` that follows always produces an empty array (since
        > `$by_groups` is a subset of `$this->denied_groups`), so the inner
        > `sizeof < 1` is always true. The likely intent was
        > `sizeof($by_groups) > 0`.  The Go port should fix this.

5. **Restricted — second chance via `current_folder` allows:**
   a. If `$have_access` is still `false`:
      - If `$user->name` exists in `$this->current_allowed_users` → set
        `$have_access = true`.
      - Else: intersect `$user->get_groups()` with `$this->current_allowed_groups`. If
        the intersection is non-empty → set `$have_access = true`.

6. **If `$user` is null** (not logged in): all checks are skipped and `$have_access`
   remains `false` when the tree is restricted.

Return `$have_access`.

### Summary table

| Condition | Result |
|---|---|
| User is admin | Allow |
| Tree has no `-access` files | Allow |
| User in `allowed_users` | Allow (unless overridden by deny) |
| User in an `allowed_groups` group | Allow (unless overridden by deny) |
| User in `denied_users` | Deny (even if previously allowed) |
| User in **>1** `denied_groups` groups (bug, see above) | Deny |
| User in `current_allowed_users` | Allow (second-chance after deny) |
| User in a `current_allowed_groups` group | Allow (second-chance after deny) |
| Not logged in, tree is restricted | Deny |

---

## 5. Controller flow

When a request hits the `access` action (`filebrowser.php:78`):

1. Resolve the path from `$_GET['path']`.
2. Call `load_access($folder)` — walk the tree, collect all `-access` files (§2.1).
3. If `is_restricted()` is `true` **and** the user is not logged in:
   - Save `return_path` in session → redirect to `/login`.
4. Call `check_access($user)`:
   - If **allowed**: serve the file (with streaming, caching headers, optional download
     disposition) or, for `.oplx` folders, serve a ZIP archive.
   - If **denied**: redirect to `/denied` (shows the `pages/denied` view).

---

## 6. Per-item gating in listings

`FileFolder` (`FileFolder.php:30-65`) wraps the global `Access` singleton for
per-file/per-folder checks:

- `load_access()` — creates a fresh `Access` instance and walks from the item's
  containing folder upward (`$checking_child = true`).
- `is_restricted()` — are there `-access` files above this item?
- `contains_access_file()` — does this specific folder contain its own `-access` file?
- `have_access($user)` — convenience that calls `load_access()` then `check_access()`.

`Subfolio.php` uses `is_restricted()` and `contains_access_file()` to annotate listings
(lines 909, 1184, 1351, 1448, 1490) — e.g. skipping restricted items in prev/next
navigation.

---

## 7. Go port notes

1. **Root-jailing.** The upward walk must stop at the configured content root, not the
   filesystem root. This is a security requirement already captured in the Phase 1
   skeleton.

2. **`-access.txt` fallback.** Keep the `.txt` variant support for backwards
   compatibility, or drop it if the config migration tooling handles renaming.

3. **Fix the `> 1` deny-groups bug** (step 4a in §4). Use `> 0` (i.e. membership in
   any denied group triggers deny).

4. **`current_folder` denies.** Decide whether to activate `deny_users`/`deny_groups`
   under `current_folder` (the sample file documents them, the PHP code comments them
   out).

5. **Stateless design.** The PHP `Access` object is a mutable singleton that accumulates
   state across `load_access_file` calls. The Go port should separate the tree-walk
   (collecting files) from the rule resolution (computing the effective allow/deny
   sets), making it testable without side effects.

6. **Caching.** The PHP reloads `-access` files on every request. The Go port should
   consider caching the resolved access policy per folder tree with a short TTL and
   filesystem-watch invalidation.
