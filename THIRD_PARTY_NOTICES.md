# Third-party notices

The plugin source is licensed under AGPL-3.0-only. The build uses the packages below; their source and license files are supplied by npm when installing dependencies. None of these packages is a runtime dependency of the sandboxed plugin.

| Component | Version | License | Use and source |
| --- | --- | --- | --- |
| esbuild | 0.25.12 | MIT | JavaScript build tool; https://github.com/evanw/esbuild |
| fflate | 0.8.3 | MIT | Workshop ZIP generation; https://github.com/101arrowz/fflate |
| Vite | 7.3.6 | MIT | Vitest transform dependency, pinned for reproducible peer resolution; https://github.com/vitejs/vite |
| Vitest | 4.1.6 | MIT | Panel tests; https://github.com/vitest-dev/vitest |
| jsdom | 29.1.1 | MIT | Test DOM; https://github.com/jsdom/jsdom |
| ECHO Workshop SDK preview generator | 1.21.0 | MIT | `vendor/preview-png.mjs`, copied unchanged from https://github.com/Moekotori/echo-workshop-sdk/tree/main/lib/preview-png.mjs |

The full MIT notice for the vendored preview generator is in [vendor/LICENSE](vendor/LICENSE). Only that standalone helper is vendored; no SDK runtime, ECHO main-process code, or media extraction code is bundled.

Character artwork provenance is documented in [ASSETS.md](ASSETS.md). The original generated artwork is included under this repository's AGPL-3.0-only license. DeepSeek and platform names remain their respective owners' names; this is an independent ECHO plugin.
