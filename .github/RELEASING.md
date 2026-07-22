# Releasing

Publishing starts only when a GitHub Release is published. Merging or pushing to
`main` never publishes by itself.

## One-time setup

1. Create a GitHub Environment named `npm` and configure any required reviewer
   and deployment-tag protection.
2. Configure npm Trusted Publishing for `@sovea/electron-ipc-service`:
   - Owner: `Sovea`
   - Repository: `electron-ipc-service`
   - Workflow: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
3. Require the `Verification gate` check before merging pull requests.

Do not configure `NPM_TOKEN` or `NODE_AUTH_TOKEN` for this workflow.

## Stable release

1. Open a `release/vX.Y.Z` pull request that changes `package.json.version` to
   `X.Y.Z`. A `release` label can be used instead of the branch convention.
2. Merge after the release E2E matrix, stress suite, and `Verification gate`
   succeed.
3. Create and publish GitHub Release `vX.Y.Z` on the merge commit. Do not mark it
   as a prerelease.
4. Approve the `npm` environment deployment. The package is published under
   npm's `latest` dist-tag.

## Prerelease

1. Choose a CI-green commit from `main` or a prerelease branch such as `next`.
   Run the `Verify` workflow with the `release` profile first when the candidate
   has not already passed the release matrix.
2. Create an immutable tag such as `v0.2.0-alpha.0` or `v0.2.0-rc.0`, then create
   and publish a GitHub prerelease for that tag.
3. Approve the `npm` environment deployment. CI applies the tag version only in
   its workspace and publishes the package under npm's `next` dist-tag.

Do not commit prerelease versions to `main`. Never move or reuse a tag after its
version has been published to npm.

## Failure handling

`npm publish` is the workflow's final step. If it fails, first check whether the
exact version exists on npm. Rerun the failed workflow only when it was not
published; npm versions cannot be overwritten.
