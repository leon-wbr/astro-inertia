/** Strips a leading "./" or slashes and any trailing slashes: "./src/pages/" becomes "src/pages". */
export const trimSlashes = (path: string): string => path.replace(/^\.?\/+|\/+$/g, "");

/** Strips trailing slashes only: "/site/" becomes "/site". */
export const trimTrailingSlashes = (path: string): string => path.replace(/\/+$/, "");
