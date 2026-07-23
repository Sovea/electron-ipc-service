# Contributing

## Requirements

- Node.js 22.13.0 or newer
- pnpm 11.15.1, as pinned by `packageManager`

Enable Corepack if pnpm is not already available:

```sh
corepack enable
pnpm install --frozen-lockfile
```

The workspace permits Electron's install script and explicitly denies the
unneeded `core-js` build script.

## Verification

Run the source, type, package, and formatting checks:

```sh
pnpm exec tsc -p tsconfig.json --noEmit
pnpm run test:types
pnpm run test:e2e:types
pnpm run test:e2e:runner
pnpm run test:package
pnpm run check:ci
```

`test:package` builds the package from a clean-compatible `prepack` path,
checks the npm manifest, and validates both public entrypoints with publint and
Are The Types Wrong.

## Electron E2E

The E2E runner builds a clean `esm/` output, packs the real npm tarball, and
installs it into an isolated Vite consumer before launching Electron:

```sh
pnpm run test:e2e          # minimum supported Electron
pnpm run test:e2e:current  # pinned current Electron
pnpm run test:e2e:stress   # five rounds of concurrent requests
```

On Debian or Ubuntu, install the browser and Electron system dependencies and
run under Xvfb:

```sh
pnpm run test:e2e:install-deps
xvfb-run -a pnpm run test:e2e
```

Failed setup or launch runs preserve their temporary consumer and write
metadata to `test-results/e2e-setup.json`.

## Releases

Maintainer release steps are documented in
[.github/RELEASING.md](./.github/RELEASING.md). Pull requests and pushes never
publish a package by themselves.
