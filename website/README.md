# Approved landing snapshot

`landing/` is a byte-for-byte copy of the approved public landing build used by the
existing unified development entrance at the start of Stage 4 (28 public files,
including photo credits). It contains no account data or environment configuration.
The original design workspace remains unchanged.

Production packaging consumes this repository snapshot, not a developer-specific
absolute path. It changes only asset prefixes, the existing authentication entry
dependency, homepage authentication CSP, and same-origin `/cloud` CTA wiring in
generated output. The approved markup, styles, illustrations and interactions remain
the source of truth. Review future design updates before replacing this snapshot.

The Vite development entrance now reads this same repository snapshot. The older
ChatGPT Sites preview is historical context, not an application source.
