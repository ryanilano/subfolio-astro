/**
 * Language string lookup — replaces `SubfolioLanguage::get_text()`.
 * Phase 2 ships English only; other languages can be added as YAML files.
 *
 * Keys and default English text from SPEC-theme-api §5.1.
 */
const STRINGS: Record<string, string> = {
  kind: "Kind",
  lastmodified: "Last Modified",
  size: "Size",
  comment: "Comment",
  downloadfile: "Download File",
  downloadzip: "Download Zip",
  viewsite: "View Site",
  seealso: "See Also",
  filename: "Filename",
  date: "Date",
  emptyfolder: "No items in this directory.",
  accessdenied: "Access Denied",
  loginasadifferentuser: "Login as a different user",
  notfound: "Not Found",
  check_url_go_back: "Check the URL or go back to",
  authenticationrequired_title: "Authentication Required",
  authenticationrequired_subtitle: "",
  username: "Username",
  password: "Password",
  remember_my_login: "Remember my login",
  submit: "Submit",
  logout: "Logout",
  indexof: "Index of",
  updated_since: "Updated since",
  last_week: "Last week",
  last_month: "Last month",
  my_last_visit: "My last visit",
  collapseheader: "Collapse Header",
};

/** Look up a localised string by key, falling back to the key itself. */
export function t(key: string): string {
  return STRINGS[key] ?? key;
}
