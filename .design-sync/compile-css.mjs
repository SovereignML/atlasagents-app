// design-sync: compile the SovereignML UI-kit stylesheet.
//
// Runs the Tailwind v4 CLI over tw-entry.css (which imports the app's
// globals.css and scopes @source to the components + authored previews),
// then rewrites the local @font-face url()s from the app's runtime "/fonts/"
// path to the bundle-relative "fonts/" path so the shipped woff2 (copied via
// cfg.extraFonts) resolve inside the Design pane. Output: .cache/tailwind.css,
// which cfg.cssEntry points at. Re-run before every package-build.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const cli = resolve(here, '../.ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs');
const input = resolve(here, 'tw-entry.css');
const out = resolve(here, '.cache/tailwind.css');

execFileSync('node', [cli, '-i', input, '-o', out], { cwd: repo, stdio: 'inherit' });

let css = readFileSync(out, 'utf8');
// Point local @font-face url()s at the real public/fonts/ source, RELATIVE to
// this output file (.design-sync/.cache/). The converter's extractFonts then
// resolves them from disk, copies the woff2 into the bundle's fonts/, and
// rewrites the url to "./<name>". (A bundle-relative "fonts/" path here isn't
// resolvable at build time, so extractFonts would leave it dangling.)
css = css.replace(/url\((['"]?)\/fonts\//g, 'url($1../../public/fonts/');
writeFileSync(out, css);
console.error(`compile-css: wrote ${out} (${(css.length / 1024).toFixed(0)} KB)`);
