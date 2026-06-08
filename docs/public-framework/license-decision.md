# License Decision

AICF uses the MIT license for the v1 public release.

This is an intentional project decision. The root framework package,
`@aicf/agent-skills`, the Codex plugin metadata, tracked skill frontmatter, README text,
package metadata, and release checks must all agree on MIT unless maintainers make an
explicit future license change.

MIT keeps the framework easy to adopt, fork, inspect, and embed in application stacks.
AICF still expects host applications to own their own legal review, security review,
compliance obligations, provider terms, and production risk decisions.

The release certification gate includes `npm run check:metadata` to confirm the license
and public identity are consistent before a v1 tag is published.

Dependency licenses are checked separately with `npm run check:licenses`. That gate uses
the root and `agent-skills` lockfiles, allows common permissive licenses by default, and
requires explicit public review records for any exception in
[Dependency License Exceptions](../public/license-exceptions.md).
