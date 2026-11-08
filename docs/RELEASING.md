# Releasing

The npm package is `agents-contributing`. `.github/workflows/publish.yml` publishes it when a tag `v*.*.*` is pushed, and it only packs (a dry run) otherwise.

## Authentication

npm revoked classic tokens on 2025-12-09 ([GitHub changelog](https://github.blog/changelog/2025-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/)), so there is no "Automation" token any more. The workflow supports two ways to publish. A dry run needs neither.

### 1. Trusted publishing (preferred, no secret)

On npmjs.com open the package **Settings → Trusted publisher → GitHub Actions** and enter: owner `matipojo`, repository `agents-contributing`, workflow `publish.yml`. npm then accepts the short-lived OIDC identity of that workflow, so no token is stored anywhere. This needs npm 11.5.1 or later; the workflow installs a pinned npm 11. Leave the `NPM_TOKEN` secret unset and the workflow takes this path.

Not confirmed: whether a package that does not exist yet can be configured this way before its first publish. If npm requires the package to exist first, do the first publish with the token below, then switch to trusted publishing.

### 2. Granular token (fallback)

1. On npmjs.com open **Access Tokens → Generate New Token → Granular Access Token**, with read and write on packages. Until the package exists it must be allowed to create new packages (no single-package restriction). A write token lasts at most 90 days and may require two-factor authentication, so it has to be renewed.
2. On GitHub open **Settings → Secrets and variables → Actions → New repository secret**, name it `NPM_TOKEN`, and paste the token.
3. Do not commit the token or echo it in a log. When the secret is set, the workflow publishes with it.

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

A dry run packs the package and prints what would be uploaded. It does not publish, and it needs neither the token nor trusted publishing.

From a checkout, the same pack the workflow publishes:

```bash
npm publish --dry-run
```

Do the real upload from the workflow, not from a laptop.

On GitHub: **Actions → Publish → Run workflow**. The `dry_run` input defaults to true. The job adds `--dry-run` when that input is true, and also whenever the run is not a tag. A real publish happens only for a `v*.*.*` tag (or a manual run of that tag with dry run turned off) and only when one of the two authentication methods is configured.

`npm run smoke` is the local check that the tarball installs, and that `agents-contributing --version` and `agents-contributing validate` both succeed.

## After the first publish

The skills and the templates will move to `npx agents-contributing@<version>` only after the first successful publish. Until that release is on npm, they keep cloning this repository.
