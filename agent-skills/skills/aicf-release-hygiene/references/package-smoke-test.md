# Package Smoke Test

For npm review:

1. Build the package.
2. Run package dry-run and inspect file list.
3. Install the packed package into a clean temporary project.
4. Import public subpaths expected by the package.
5. Run CLI help if the package exposes a CLI.
6. Delete temporary output unless debugging requires keeping it.
