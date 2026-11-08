# Releasing

Package: `agents-contributing`.

`.github/workflows/publish.yml` (workflow name `publish`) runs on a push of a tag `v*.*.*`, and from **Actions → publish → Run workflow**.

The job adds `--dry-run` unless the ref is a tag and `dry_run` is not `true`. A tag push has no `dry_run` input, so it publishes. The manual `dry_run` input defaults to `true`. A dry run needs no npm credentials.

Workflow permissions: `contents: read`, `id-token: write`. `id-token: write` is required for trusted publishing and for `--provenance`.

## Trusted publishing

On npmjs.com open the package **Settings → Trusted publisher → GitHub Actions** and set:

- owner: `matipojo`
- repository: `agents-contributing`
- workflow: `publish.yml`

Leave the Actions secret `NPM_TOKEN` unset. The workflow then publishes with GitHub OIDC.

Trusted publishing requires npm 11.5.1 or later. The workflow installs npm 11.21.2.

If npm refuses trusted publishing for a package that does not exist yet, publish the first version with an `NPM_TOKEN` secret (a granular token with permission to create packages). Then add the trusted publisher above and delete the `NPM_TOKEN` secret.

## Granular token

1. On npmjs.com open **Access Tokens → Generate New Token → Granular Access Token**. Grant read and write on packages. For a package that does not exist yet, allow creating new packages and do not limit the token to one package.
2. On GitHub open **Settings → Secrets and variables → Actions → New repository secret**. Name: `NPM_TOKEN`. Value: the token.
3. Store the token only in the `NPM_TOKEN` secret. While that secret is set, the workflow publishes with it.

A write token expires within 90 days. Generate a new token and update the `NPM_TOKEN` secret before it expires.

## Cut a release

From a clean `main`, after `npm test` and `npm run smoke` pass:

```bash
npm version patch   # or minor, or major, or x.y.z
git push origin main --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, commits, and creates tag `vX.Y.Z`. The tag with the leading `v` removed must equal the `version` field.

If they differ, the workflow prints this and exits 1:

```text
Tag <tag> does not match package.json version <version>.
The tag without the leading v must equal the version. See docs/RELEASING.md.
```

Delete the bad tag and push a tag named `v` plus the `version` in `package.json`:

```bash
git tag -d BAD_TAG
git push origin :refs/tags/BAD_TAG
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
```

The job then runs `npm run typecheck`, `npm run build`, `npm test`, and `npm publish --provenance --access public`.

`package.json` sets `publishConfig.access` to `public` and `publishConfig.provenance` to `true`.

Publish from this workflow.

## Dry run

From a checkout:

```bash
npm publish --dry-run
```

On GitHub: **Actions → publish → Run workflow**.

`npm run smoke` installs the packed tarball in an empty directory, then runs `agents-contributing --version` and `agents-contributing validate` on a copy of `templates/AGENTS-CONTRIBUTING.md`. `--version` must print the `version` from `package.json`.
