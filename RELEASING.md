# Releasing

Releases are driven by an annotated git tag `vX.Y.Z` on `main`.

## Cutting a release

1. **Changelog.** Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` in
   `CHANGELOG.md` and add a fresh empty `## [Unreleased]` above it. Commit
   and push to `main`; CI must be green.
2. **Tag and push:**
   ```bash
   git switch main && git pull
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
3. The **Release** workflow (`.github/workflows/release.yml`):
   - derives the module version from the tag (`v0.1.0` becomes `0.1.0`).
     Plain `x.y.z` only: Ignition's `module.xml` version parser is numeric,
     so prerelease suffixes are rejected. Bump the patch number instead.
   - builds and **signs** the `.modl` (it carries `license.html`, the
     install-time EULA) and checks the signature landed,
   - packages the demo project (`ops/package-demo.sh`) as a Designer import,
   - creates a draft GitHub Release named `v0.1.0`, attaches the signed
     `.modl` and `Mustry-Doom-Demo-Project.zip`, then flips it public with
     the changelog section as notes.

The tag should point at a commit already on `main`, so the e2e gateway run
has already passed for it; the release build signs rather than re-testing.

## Dry run

**Actions → Release → Run workflow** with `dry_run` on builds and signs
without publishing and uploads the signed `.modl` as a workflow artifact.
Use it once after adding the secrets, before the first real tag.

## Signing secrets

Signing runs only in the Release workflow. The five secrets are
**organisation secrets** of Mustry-Solutions with a "selected repositories"
policy; a new module repo must be added to each secret's repository list
(**Organisation → Settings → Secrets and variables → Actions → the secret →
Repository access**) or the release fails at the signing step. The names:

| Secret | What |
|---|---|
| `SIGNING_KEYSTORE_B64` | Base64 of the signing keystore (`.p12`/`.jks`): `base64 -i keystore.p12` |
| `SIGNING_CERT_B64` | Base64 of the certificate chain (`.pem` or `.p7b`) |
| `SIGNING_KEYSTORE_PASSWORD` | Keystore password |
| `SIGNING_CERT_ALIAS` | Key alias inside the keystore |
| `SIGNING_CERT_PASSWORD` | Key password (often the same as the keystore password) |

If any is missing the release fails fast and names them. The signing
material is never committed; the self-signed keystore under `ops/signing/`
is for the dev gateway only.

The same Mustry certificate signs every Mustry module, so a gateway that has
accepted one already trusts this one.
