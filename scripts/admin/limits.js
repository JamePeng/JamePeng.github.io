// Shared by the editor and local server so each stage accepts the same sizes.
export const MAX_SAVED_HTML_MB = 50;
export const MAX_BODY_MB = 10;
export const MAX_SAVED_HTML_BYTES = MAX_SAVED_HTML_MB * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_BODY_MB * 1024 * 1024;
// A JSON escape can use six bytes for one source byte; leave room for metadata.
export const MAX_JSON_BYTES = MAX_BODY_BYTES * 6 + 64 * 1024;
