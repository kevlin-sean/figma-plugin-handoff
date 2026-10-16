Offline WebP codec provenance

Derived from the bundled Playwright 1.62.1 lib/coreBundle.js Emscripten WebP glue and lib/webp_codec.wasm. The bundle wrapper was removed and the factory is exposed as HandoffWebPModule. The binary is unchanged.

Upstream: https://github.com/microsoft/playwright/tree/v1.62.1/packages/utils/webp
Codec: https://github.com/webmproject/libwebp
Licenses: WebP-LICENSE.txt and Playwright-LICENSE.txt.
Binary SHA-256: 164cd9583a3e4d081f767d3b41ff0a730443dc7535fcc5caff83561463384b79

Only the Figma export UI contains the codec. Generated handoff archives contain the resulting preview, without the codec or its runtime.
