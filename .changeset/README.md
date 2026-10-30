# Changesets

Every pull request, and every commit pushed straight to `main`, adds one file here describing what it changes for the people who use the software in this repository. [Changesets](https://changesets.dev) turns those files into version bumps and `CHANGELOG.md` entries.

```sh
mise run changeset              # pick the bump (patch / minor / major) and write the summary
mise run changeset -- --empty   # nothing releasable changed; say so explicitly
mise run version                # apply pending changesets: bump package.json, write CHANGELOG.md
```

Write the summary for a reader of the changelog, not for the reviewer of the diff: what they can now do, what no longer works, what they must change.

This repository has one version, carried by the private root `package.json`. That file is the adapter's own manifest, so there is nothing to sync it into: `mise run version` bumps it and writes `CHANGELOG.md`. The package is private and there is no publication or deployment step; the changelog exists so the history of the prototype is readable.
