# Releasing

Publishing starts only when a GitHub Release is published. Pull requests,
merges, and pushes never publish by themselves.

## One-time setup

1. Create a GitHub Environment named `npm` with the required reviewer and a
   custom deployment policy that permits tags matching `v*`.
2. Configure npm Trusted Publishing for `@sovea/electron-ipc-service`:
   - Owner: `Sovea`
   - Repository: `electron-ipc-service`
   - Workflow: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
3. Create the `release` pull-request label.
4. Require `Verification gate` in the default-branch ruleset.
5. Protect `v*` tags from update and deletion.

Do not configure `NPM_TOKEN` or `NODE_AUTH_TOKEN` for this workflow.

## Stable release

1. Open a normal version-preparation pull request and update
   `package.json.version` to `X.Y.Z`. Add the `release` label to select the full
   release E2E matrix and stress suite.
2. Merge only after the release jobs and `Verification gate` succeed.
3. On the final `main` commit, manually run the `Verify` workflow with the
   `release` profile. Use that exact commit as the release target.
4. Prepare GitHub Release notes covering features, compatibility, fixes, and
   any migration required from a prerelease.
5. Create and publish GitHub Release `vX.Y.Z`. Do not mark a stable release as
   a prerelease.
6. Approve the `npm` environment deployment. The workflow publishes under the
   npm `latest` dist-tag.

For the first stable release, `package.json` already contains `0.1.0`, so its
preparation pull request does not need another version change.

## Prerelease

1. Choose a CI-green commit from `main` or a prerelease branch such as `next`.
   Run the `Verify` workflow with the `release` profile on that commit.
2. Create an immutable tag such as `v0.2.0-alpha.0` or `v0.2.0-rc.0`, then
   create and publish a GitHub prerelease for that tag.
3. Approve the `npm` environment deployment. CI applies the prerelease version
   only in its workspace and publishes under the npm `next` dist-tag.

Do not commit prerelease versions to `main`. Never move or reuse a tag after its
version has been published to npm.

## Post-publish checks

Verify the registry version and dist-tags:

```sh
npm view @sovea/electron-ipc-service version dist-tags --json
npm view @sovea/electron-ipc-service@X.Y.Z dist.integrity --json
```

Confirm that npm shows provenance for the published version and inspect the
tarball contents from a clean consumer. A stable publish updates `latest`;
remove the legacy `alpha` dist-tag separately only when that channel is no
longer useful.

## Failure handling

`npm publish` is the workflow's final step. If it fails, first check whether the
exact version exists on npm. Rerun the failed workflow only when it was not
published; npm versions cannot be overwritten.
