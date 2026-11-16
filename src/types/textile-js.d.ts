/**
 * Types for `textile-js` (MIT, https://github.com/borgar/textile-js), which ships
 * none. Only the call `src/lib/renderText.ts` makes is declared.
 */
declare module "textile-js" {
  interface TextileOptions {
    /** Single newlines inside a block become `<br />`. Default true. */
    breaks?: boolean;
  }
  /** Convert Textile source to an HTML string. */
  function textile(source: string, options?: TextileOptions): string;
  export default textile;
}
