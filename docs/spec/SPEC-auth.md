# SPEC-auth: Authentication, Users & Groups

> Extracted from the PHP engine for Go reimplementation.
> Sources: `engine/application/libraries/Auth.php`, `engine/application/libraries/User.php`,
> `config/users/users.sample.yml`, `config/users/groups.sample.yml`,
> `engine/application/config/auth.php`, `engine/application/config/filebrowser.php`.

---

## 1. Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  users.yml  │────▶│  Auth (lib)  │────▶│  PHP $_SESSION   │
│ groups.yml  │     │              │     │  (server-side)   │
└─────────────┘     │  hash()      │     └──────────────────┘
                    │  login()     │
                    │  logged_in() │     ┌──────────────────┐
                    │  logout()    │────▶│  autologin cookie │
                    │  user_group_ │     │  (client-side)    │
                    │  list()      │     └──────────────────┘
                    └──────────────┘
```

- **Auth** (`Auth.php`) is a singleton. It loads `users.yml` and `groups.yml` at construction time via `Spyc::YAMLLoad()`.
- **User** (`User.php`) is a simple data object populated from a `users.yml` entry.
- Session storage is server-side (PHP `$_SESSION` via Kohana's `Session` class).
- A persistent "remember me" cookie (`auth_{config_name}_autologin`) bridges sessions.

---

## 2. Config Sources

Two config files contribute auth settings:

### 2.1 `engine/application/config/auth.php`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `user_model` | string | `'user'` | Kohana ORM model name (not used by the custom Auth lib) |
| `username` | string | `'username'` | Column name for username (not used by custom Auth lib) |
| `password` | string | `'password'` | Column name for password (not used by custom Auth lib) |
| `session` | string | `'session'` | Session column name (not used by custom Auth lib) |
| `hash_method` | string | `'sha1'` | **Declared** hash method — but the custom Auth lib ignores this and uses its own `md5`-based `hash()` method. **This value is misleading.** |
| `lifetime` | int | `1209600` | "Remember me" cookie lifetime in seconds (2 weeks) |
| `session_key` | string | `'auth_user'` | Key used to store the User object in the PHP session |
| `salt` | string | `'562adsf53asdf79asdf09870'` | Salt for the auto-login cookie token hash (distinct from the password-hash salt) |

### 2.2 `engine/application/config/filebrowser.php` (auth-relevant subset)

| Key | Type | Default | Overridable via `settings.yml` | Meaning |
|---|---|---|---|---|
| `auth_session` | string | `'1Gmo0pangF8FZ05R'` | Yes | HMAC-style secret for session integrity |
| `auth_salt` | string | `'W8Kivk5ykGhSrc11'` | Yes | Global salt used in the password hash function |
| `users_yaml_file` | string | `{users_folder}/users.yml` | Yes (filename only; path prefix fixed) | Path to the users YAML file |
| `groups_yaml_file` | string | `{users_folder}/groups.yml` | Yes (filename only; path prefix fixed) | Path to the groups YAML file |

The `users_folder` prefix is set in `filebrowser.php` and points to a configurable directory (typically `config/users/`). If `settings.yml` overrides `users_yaml_file` or `groups_yaml_file`, only the filename portion is taken; the `users_folder` prefix remains fixed.

---

## 3. The Hash Function (⚠ CRITICAL SECURITY)

```php
// Auth.php:176-178
public function hash($str) {
    $salt = Kohana::config('filebrowser.auth_salt');
    return md5($salt.$str);
}
```

**Algorithm:** `md5(global_auth_salt . input)`

| Property | Value |
|---|---|
| Hash function | MD5 |
| Salt type | **Global** (same salt for all users) |
| Salt source | `filebrowser.auth_salt` config key |
| Default salt | `W8Kivk5ykGhSrc11` |
| Salt position | Prepended to input |
| Per-user salt | **None** |

### ⚠ Security Risk: Plaintext Passwords

The `users.yml` schema supports **two** password fields:

| Field | Storage | Comparison |
|---|---|---|
| `password` | **Plaintext** in YAML | Direct string equality (`===`) |
| `hashed_password` | `md5(global_salt . password)` | Hash then compare |

If both fields are present, `hashed_password` takes precedence. If only `password` is present, the submitted password is compared **directly, in plaintext**. This means:

1. **Plaintext passwords are stored on disk** in `users.yml`.
2. The MD5 hash uses a **global salt only** — no per-user salt, making rainbow-table attacks feasible if the salt is ever exposed.
3. MD5 is cryptographically broken for password hashing.

**For the Go port:** Replace with `bcrypt` (via `golang.org/x/crypto/bcrypt`). Provide a migration command (`subfolio hashpw`) that reads `users.yml`, bcrypt-hashes all `password` entries (writing them to `hashed_password`), and strips the plaintext field. See also the hash verification path below for the exact comparison logic that must be replicated during migration.

---

## 4. Hash Verification Path (Step by Step)

This is the password verification flow in `Auth::login()` (lines 113–155):

```
1. Reject immediately if submitted password is empty.

2. Look up the username in $this->users (the parsed users.yml).
   → If not found, return false.

3. Construct a User object from the YAML entry for that username.
   → User fields populated: name, fullname, password, hashed_password, admin.

4. Resolve the user's group memberships via user_group_list()
   → Groups are set on the User object.

5. BRANCH on the user's password fields:

   ┌── hashed_password is non-empty?
   │   YES → Compute hash(submitted_password)
   │          Compare hash(submitted_password) === stored hashed_password
   │          Match? → login succeeds
   │          No match? → return false
   │
   │   NO  → Compare submitted_password === stored password (plaintext)
   │          Match? → login succeeds
   │          No match? → return false
   └──

6. On success:
   a. Store the User object in the PHP session under session_key ('auth_user').
   b. If $remember is true:
      - Compute token: username . ":" . hash(username . auth_config_salt)
        where hash(x) = md5(filebrowser.auth_salt . x)
        and auth_config_salt = '562adsf53asdf79asdf09870'
      - Set cookie "auth_{config_name}_autologin" = token
      - Cookie lifetime = 1209600 seconds (2 weeks)
   c. Return the User object.
```

### Decision Table

| User has `hashed_password`? | User has `password`? | Comparison |
|---|---|---|
| Yes (non-empty) | — (ignored) | `hash(submitted) === hashed_password` |
| No (empty) | Yes | `submitted === password` (plaintext compare) |
| No (empty) | No (empty) | Login always fails (empty password rejected at step 1) |

---

## 5. Login Flow (Full)

```
POST /login
  │
  ▼
Auth::login($username, $password, $remember)
  │
  ├─ password empty? → return false
  ├─ username not in users.yml? → return false
  │
  ├─ hashed_password set?
  │   └─ md5(auth_salt . $password) === stored_hash? → success
  │
  └─ else (plaintext password)
      └─ $password === stored_plaintext? → success
          │
          ▼
        $_SESSION['auth_user'] = User object
          │
          ├─ $remember === true?
          │   └─ setcookie("auth_auth_autologin",
          │        "username:md5(auth_salt . username . auth_config_salt)",
          │        expire = now + 1209600)
          │
          ▼
        return User object
```

---

## 6. Session Restoration (Auto-Login / "Remember Me")

When `Auth::logged_in()` is called (lines 61–102):

```
1. Check PHP session for $_SESSION['auth_user'].
   → If present and is an object:
      a. Verify the user still exists in users.yml.
         If deleted → clear session, set status=false.
      b. If still exists → status=true.

2. If status is still false (no valid session user):
   a. Read cookie "auth_{config_name}_autologin".
   b. If cookie exists and is a string:
      - Split on ":" → [username, hash_from_cookie]
      - Recompute: hash(username . auth_config_salt)
        where hash(x) = md5(filebrowser.auth_salt . x)
        and auth_config_salt is from auth.php config.
      - If recomputed hash === hash_from_cookie:
         ✓ Construct User from users.yml entry
         ✓ Store User in session
         ✓ status = true

3. If status is true:
   a. Resolve group memberships.
   b. Verify user still exists in users.yml (double-check).
   c. Return User object.

4. Otherwise return false.
```

### Cookie Structure

```
Cookie name:  auth_auth_autologin
Cookie value: {username}:{token_hash}
              └──────────┘ └──────────────────────────────────────┘
              e.g. johndoe:6fb4d8e2a1c3f9b507e1d2a8c4f6e9b0

Token hash:   md5(filebrowser.auth_salt . username . auth.salt)
              └────────────────────┘            └──────────────┘
              default: W8Kivk5ykGhSrc11          default: 562adsf53asdf79asdf09870
```

The `config_name` parameter (default `'auth'`) is interpolated into the cookie name, allowing multiple independent Auth instances.

---

## 7. Logout Flow

```php
// Auth.php:157-174
public function logout($destroy = false) {
    // 1. Delete the autologin cookie if it exists
    if (cookie::get("auth_{$this->config_name}_autologin")) {
        cookie::delete("auth_{$this->config_name}_autologin");
    }

    // 2a. Full destroy: wipe entire session
    if ($destroy === true) {
        Session::instance()->destroy();
    }
    // 2b. Soft logout: remove user from session, regenerate session ID
    else {
        $this->session->delete($this->config['session_key']);  // unset auth_user
        $this->session->regenerate();                            // new session ID
    }

    // 3. Confirm user is no longer logged in
    return ! $this->logged_in();
}
```

Two modes:
- **Soft logout** (`$destroy = false`, default): Removes only the auth user from the session, regenerates the session ID (session fixation protection). Other session data is preserved.
- **Hard logout** (`$destroy = true`): Destroys the entire session.

---

## 8. User Object (`User.php`)

```php
class User {
    var $name;             // string — username (key in users.yml)
    var $fullname;         // string — display name (defaults to $name if not set)
    var $password;         // string — plaintext password (⚠ insecure)
    var $hashed_password;  // string — md5(auth_salt . plaintext_password)
    var $admin;            // bool   — admin flag
    var $groups;           // array  — group IDs the user belongs to (populated post-construction)
}
```

### Constructor logic (User.php:10-17)

| Field | Source from YAML | Default if missing |
|---|---|---|
| `name` | YAML key (the username) | (required — constructor arg) |
| `fullname` | `$array['fullname']` | `$name` (the username) |
| `password` | `$array['password']` | `''` (empty string) |
| `hashed_password` | `$array['hashed_password']` | `''` (empty string) |
| `admin` | `$array['admin']` | `false` |
| `groups` | Not set at construction | Set later via `set_groups()` |

---

## 9. Group Membership Resolution

Groups are defined in `groups.yml` and resolved by scanning all groups for the user's name:

```php
// Auth.php:38-49
public function user_group_list($user) {
    $groups = array();
    if (is_array($this->groups)) {
        foreach ($this->groups as $id => $group) {
            if (in_array($user->name, $group)) {
                $groups[] = $id;
            }
        }
    }
    return $groups;
}
```

```php
// Auth.php:51-59
public function in_group($user, $groupname) {
    if (isset($this->groups[$groupname])) {
        if (in_array($user->name, $this->groups[$groupname])) {
            return true;
        }
    }
    return false;
}
```

**Algorithm:** O(N×M) scan — for each group, check if the user's name appears in the group's member list. Returns an array of group ID strings. Used by `Access.php` for access-control checks.

---

## 10. YAML Schemas

### 10.1 `users.yml` Schema

```yaml
# Top-level keys are usernames. Each value is a map of user properties.
<username>:
  fullname: <string>           # Display name. Optional, defaults to <username>.
  password: <string>           # Plaintext password. ⚠ INSECURE. Mutually exclusive in practice with hashed_password.
  hashed_password: <string>    # Pre-computed md5(auth_salt . password). Takes precedence over password if non-empty.
  admin: <bool>                # Admin flag. Optional, defaults to false.
```

**Constraints:**
- Username must be unique (YAML key).
- A user SHOULD have either `password` or `hashed_password` (or both). If neither is set, login is impossible (empty password rejected at step 1 of login).
- If both `password` and `hashed_password` are set, `hashed_password` is used for verification; `password` is ignored.
- Username must exist in `users.yml` before it can be added to any group in `groups.yml`.

**Example:**
```yaml
johndoe:
  fullname: John Doe
  password: gr8p4ssw0rd       # Plaintext — compare directly
  admin: false

janedoe:
  fullname: Jane Doe
  hashed_password: 34f28698680030c6dc4873ad82eafdf5  # md5("W8Kivk5ykGhSrc11" . "secret")
  admin: true
```

**Verification for `janedoe`:**
```
md5("W8Kivk5ykGhSrc11" . "secret") = 34f28698680030c6dc4873ad82eafdf5 ✓
```

### 10.2 `groups.yml` Schema

```yaml
# Top-level keys are group IDs. Each value is a list of usernames.
<group_id>:
  - <username>
  - <username>
  - ...
```

**Constraints:**
- Group IDs must be unique (YAML key).
- Each member username must already exist in `users.yml`.
- Membership is a flat list — no nested groups, no group inheritance.
- Groups are referenced by ID string in access control (`-access` files — see SPEC-access.md).

**Example:**
```yaml
staff:
  - jane
  - john
  - etc

clients:
  - apple
  - microsoft
  - etc
```

---

## 11. Session & Cookie Summary

| Mechanism | Key/Name | Content | Lifetime |
|---|---|---|---|
| Server session | `$_SESSION['auth_user']` | Serialized User object | PHP session lifetime |
| Auto-login cookie | `auth_auth_autologin` | `username:md5(auth_salt . username . auth_salt2)` | 1,209,600 s (2 weeks) |

Both salts used in the auto-login cookie:
- **Password-hash salt** (`filebrowser.auth_salt`): `W8Kivk5ykGhSrc11` (global, overridable in settings.yml)
- **Cookie salt** (`auth.salt`): `562adsf53asdf79asdf09870` (from auth.php config)

The auto-login cookie token is computed as:
```
md5(filebrowser.auth_salt . username . auth.salt)
```

---

## 12. Go Migration Notes

### 12.1 What to Replace

| PHP | Go Replacement |
|---|---|
| `md5(global_salt . password)` | `bcrypt` via `golang.org/x/crypto/bcrypt` |
| Plaintext `password` field | **Eliminate.** Migration command bcrypt-hashes all plaintext passwords. |
| Cookie `username:hash` token | Replace with a proper HMAC or random token stored server-side |
| `$_SESSION` storage | Session middleware (e.g., `gorilla/sessions` or custom) |
| `Spyc::YAMLLoad()` | `gopkg.in/yaml.v3` or `goccy/go-yaml` |

### 12.2 Migration Path

1. Ship a `subfolio hashpw` subcommand that:
   - Reads `users.yml`
   - For each user with a `password` field (plaintext): bcrypt-hashes it, writes to `hashed_password`, deletes `password`
   - For each user with an existing `hashed_password` (old MD5 format): **cannot migrate automatically** (MD5 is one-way). Options: (a) force password reset, or (b) accept both old and new hash formats, re-hashing on next successful login.
2. The new `hashed_password` field stores a bcrypt hash (e.g., `$2a$10$...`).
3. The login flow detects the hash format and verifies accordingly.

### 12.3 Required Go Structs

```go
type User struct {
    Name           string   `yaml:"-"`                // key in users.yml
    Fullname       string   `yaml:"fullname"`
    Password       string   `yaml:"password"`         // deprecated; for migration only
    HashedPassword string   `yaml:"hashed_password"`  // bcrypt in Go port
    Admin          bool     `yaml:"admin"`
    Groups         []string `yaml:"-"`                // populated from groups.yml
}

type AuthConfig struct {
    SessionKey    string        // "auth_user"
    CookieName    string        // "auth_auth_autologin"
    CookieLifetime time.Duration // 1209600s
    // Legacy salts — needed only for migration/compat
    LegacyAuthSalt string       // filebrowser.auth_salt
    LegacyCookieSalt string     // auth.salt
}
```

---

## 13. Security Risks Summary

| # | Risk | Severity | Mitigation in Go |
|---|---|---|---|
| 1 | **Plaintext passwords** stored in `users.yml` (`password` field) | 🔴 Critical | Migration command to bcrypt-hash all plaintext passwords; remove `password` field support |
| 2 | **MD5 hashing** with only a global salt (no per-user salt) | 🔴 Critical | Replace with bcrypt (per-hash salt built in) |
| 3 | **Auto-login cookie** uses predictable `md5(salt1 . username . salt2)` — anyone who knows both salts can forge cookies for any user | 🟠 High | Replace with a random token stored server-side and hashed in the cookie, or use a proper HMAC with a single secret |
| 4 | Global `auth_salt` is shared across all users — one leaked salt compromises all password hashes | 🟠 High | bcrypt inherently includes a per-hash random salt, so this ceases to be a concern |
| 5 | `auth.php` declares `hash_method = 'sha1'` but the actual hash is MD5 — misleading config | 🟡 Low | Remove the dead config; use only the new scheme |
