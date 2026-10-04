# luaparse (vendored)

- Source: https://github.com/fstirlitz/luaparse, npm `luaparse` 0.3.1 (published June 2022, no release since).
- File: `luaparse.js` copied unchanged as `luaparse.cjs`, so Node loads the UMD build as CommonJS.
- Licence: MIT, see `LICENSE`.

Why vendored: the package is no longer maintained. Keeping it here lets fxaudit fix it
if needed. CfxLua syntax is not handled here but by `src/parse/rewrite.ts` before parsing.
