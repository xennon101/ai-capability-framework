# Dependency License Exceptions

AICF uses MIT for the public framework and accepts common permissive dependency licenses
by default. The release gate blocks unknown, copyleft, source-available, and unlicensed
dependency metadata unless maintainers document an explicit exception here.

The default allow-list is:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- CC0-1.0
- Unlicense
- BlueOak-1.0.0

Disallowed-by-default license families include GPL, AGPL, LGPL, SSPL, BUSL, unknown
licenses, and `UNLICENSED`.

The `npm run check:licenses` gate reads the package lockfiles and the JSON block below.
Exceptions must be exact by package, version, license, and package scope. Stale or
malformed exception records fail the gate.

```json
{
  "exceptions": [
    {
      "package": "argparse",
      "version": "2.0.1",
      "license": "Python-2.0",
      "scope": "root",
      "reason": "Transitive build and validation dependency; license reviewed as compatible for public package use.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Do not copy package source into AICF docs or examples."
    },
    {
      "package": "lightningcss",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Transitive TypeDoc build dependency; weak-copyleft terms are isolated to the dependency package.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Do not vendor or modify dependency source in this repository."
    },
    {
      "package": "lightningcss-android-arm64",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-darwin-arm64",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-darwin-x64",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-freebsd-x64",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-linux-arm-gnueabihf",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-linux-arm64-gnu",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-linux-arm64-musl",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-linux-x64-gnu",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-linux-x64-musl",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-win32-arm64-msvc",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "lightningcss-win32-x64-msvc",
      "version": "1.32.0",
      "license": "MPL-2.0",
      "scope": "root",
      "reason": "Optional platform package for the reviewed lightningcss dependency.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Keep usage limited to dependency installation; do not vendor source."
    },
    {
      "package": "tslib",
      "version": "2.8.1",
      "license": "0BSD",
      "scope": "root",
      "reason": "Transitive TypeScript helper dependency; 0BSD is public-domain-like and compatible with MIT distribution.",
      "approved_by": "AICF maintainers",
      "approved_at": "2026-06-08",
      "review_by": "2027-06-08",
      "constraints": "Review again if the dependency is vendored or materially modified."
    }
  ]
}
```

Host applications and downstream distributors remain responsible for their own legal
review.
