# Releasing

The npm package is `agents-contributing`. `.github/workflows/publish.yml` publishes it when a tag `v*.*.*` is pushed, and it only packs (a dry run) otherwise.

## Create the npm token

A real publish needs an npm **automation** token stored as the `NPM_TOKEN` repository secret. A dry run does not need the secret. The workflow reads the secret into `NODE_AUTH_TOKEN` and never prints it. If a real publish starts and the secret is empty, the job stops and points back here.

1. Sign in at [npmjs.com](https://www.npmjs.com/) and open **Access Tokens**.
2. Generate a new token and choose **Classic Token**, then **Automation**. An automation token can publish from GitHub Actions without an interactive two-factor prompt. Copy it once; npm does not show it again.
   Until the package exists, a granular token has to be allowed to create new packages (no single-package restriction). After the first publish, a granular token limited to `agents-contributing`, with read and write, and with two-factor authentication bypassed for CI, is enough. Keep using an automation-style token either way, so the workflow is not waiting on a person.
3. On GitHub, open the repository **Settings → Secrets and variables → Actions → New repository secret**. Name it `NPM_TOKEN` and paste the token.
4. Do not commit the token, do not put it in the workflow file, and do not echo it in a log.

## Cut a release

Start from a clean `main`, after `npm test` and `npm run smoke` have passed.

```bash
npm version patch   # or minor, or major, or an explicit x.y.z
git push origin main --follow-tags
```

`npm version` bumps `package.json` and `package-lock.json`, commits that change, and creates a tag `vX.Y.Z`. The tag without the leading `v` has to equal the `version` field. The workflow checks that and fails if they differ.

Pushing the tag runs the publish workflow: it typechecks, builds, tests, and runs `npm publish --provenance --access public`.

## What provenance gives

`--provenance` attaches a signed statement to the package on npm. The statement names the repository, the commit, and the GitHub Actions workflow that built the tarball, so anyone can check that the files on npm came from this repository and were not replaced later. The workflow sets `id-token: write` so GitHub can issue the short-lived token that signs the statement. `publishConfig.provenance` is `true` as well, so a publish of this package asks for provenance even if the flag is left off the command.

Provenance ties the tarball to the workflow run. It is not a review of what the code does.

## Dry run

A dry run packs the package and prints what would be uploaded. It does not publish, and it does not need `NPM_TOKEN`.

From a checkout, the same pack the workflow publishes:

```bash
npm publish --dry-run
```

Do the real upload from the workflow, not from a laptop.

On GitHub: **Actions → Publish → Run workflow**. The `dry_run` input defaults to true. The job adds `--dry-run` when that input is true, and also whenever the run is not a tag. A real publish happens only for a `v*.*.*` tag (or a manual run of that tag with dry run turned off) and only when `NPM_TOKEN` is set.

`npm run smoke` is the local check that the tarball installs, and that `agents-contributing --version` and `agents-contributing validate` both succeed.

## After the first publish

The skills and the templates will move to `npx agents-contributing@<version>` only after the first successful publish. Until that release is on npm, they keep cloning this repository.
