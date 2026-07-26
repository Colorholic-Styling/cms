# Asset sources

Sources that need a build step before the CMS can serve them, compiled into
`views/assets/`:

| Source | Built by | Output |
|---|---|---|
| `admin.css` | `npm run build:css` (Tailwind) | `views/assets/admin.css` |
| `richtext-md.js` | `npm run build:js` (esbuild) | `views/assets/richtext-md.js` |

They live here rather than in `views/` because `wrangler.toml` serves that
entire directory as public assets — sources placed there would be published.

Most small CMS browser scripts can live directly in `views/assets`. The rich
text editor is different because `richtext-md.js` imports the npm packages
`marked` and `turndown`. Browsers cannot resolve those package names through the
Worker's `/assets` route, so esbuild combines the editor and its dependencies
into one self-contained file:

```text
client/richtext-md.js
  + marked
  + turndown
  -> views/assets/richtext-md.js
```

The generated file runs only in the browser. The Cloudflare Worker does not
execute it; the Worker serves it at `/assets/richtext-md.js` and receives the
HTML produced by the editor when the form is submitted.

## Building

Run the browser asset build after changing files in this directory:

```sh
npm run build:js
```

`npm run build`, `npm run dev`, `npm test`, and `npm run deploy` also run this
build automatically.

Edit the source file in `client`, not the generated file in `views/assets`.
