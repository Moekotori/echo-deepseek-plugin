# Third-party notices

The plugin source is licensed under AGPL-3.0-only. Bundled runtime protocol adapters and their complete license texts are listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), included in both the plugin package and import ZIP. They include Pi AI 1.3.0 (MIT), OpenAI SDK (Apache-2.0), Anthropic SDK (MIT), partial-json (MIT), StableLib base64 (MIT), fast-sha256 (Unlicense), and standardwebhooks (upstream Apache-2.0; npm metadata also declares MIT). Only the imported protocol adapter code is bundled; Pi Agent Core and the coding-agent CLI are not included. The build and test tools below run during development; their source and license files are supplied by npm when installing dependencies.

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
