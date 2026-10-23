# Reviewed In-Memory Migration Handoff

Preparation and synthetic testing do not authorize a real transfer. Do not open or run
these pages in the founder profile until explicit approval for the exact four-record run.
The local inspector and separate cloud preflight have passed, and the immutable-offset
rules were separately approved/deployed. Recheck current state immediately before execution.

## Exact browser boundaries

Source: `http://localhost:5173/migration-source.html`, original Chrome profile, development
mode only. Receiver: `http://localhost:5176/migration-receiver.html`, cloud mode only.
Both are standalone developer pages, not linked from the scanner or landing page, and
not included in the normal production build. Neither mounts App, CloudApp, recovery hooks,
draft autosavers, or a broad storage/file API. No application storage is read on load.

1. After separate founder transfer approval, freeze edits in both workspaces and close
   other cloud editing sessions. Open the source page in the exact original Chrome profile.
2. Connect receiver opens one exact-origin popup without reading acquisitions. The popup
   retains its opener solely for the bound handshake; there is no credential/record in its
   URL. Source and receiver check exact origins AND exact window references on messages.
3. Explicitly connect the founder session in the receiver. If sign-in is needed, the normal
   Google popup is user-triggered. Sign-in only establishes auth, never starts migration.
   A 256-bit, single-offer challenge binds the two windows for at most ten minutes.
4. Explicitly send the four approved source records, with a separate confirmation. Read
   only the exact shared acquisition storage key and require four unchanged validated
   records. The browser necessarily retrieves the entire serialized entry. A narrow
   root-value scanner skips the draft bytes without slicing, deserializing, validating,
   retaining or transferring the draft value. Only selected schema/record values enter
   JSON parsing. Hold a records-only baseline and snapshot in memory; compare two
   records-only projections. Draft presence, content and independent changes do not affect
   eligibility or freshness. Structurally unreadable shared envelopes still fail closed
   when the saved-record boundaries cannot be safely located. No storage writes occur.
5. Receiver revalidates all records and renders names/sizes/status only using textContent.
   Receiving the message does not read Firestore or write anything. Replayed/malformed,
   unbound, wrong-origin or expired offers are rejected.
6. Explicitly review cloud conflicts. Read all selected acquisition/source claims from the
   server; reject mismatched/orphaned source claims and nonidentical cloud copies. This is
   read-only. A nonempty cloud draft also stops this no-draft transfer for review;
   a cleared revision marker is retained. Repeat checks after confirmation before any creates.
7. Separately confirm create-only migration. Revalidate source freshness with a new
   challenge nonce and five-second timeout before every create, and after final readback.
   Check founder auth, expiration and cancellation. Saved-record changes, a closed source tab,
   failed checks or lost auth stop further writes. Keep the source tab open and idle.
8. Use existing create-only transactions with source claims, revision-1 envelopes and
   immutable historical offsets. IDs, payloads, dates and historical revisions remain
   unchanged. Compare COMPLETE canonical server-readback content after every record.
   Do not run ordinary JSON import, autosave, update, rename or delete during handoff.
9. Success reports only verified/created/identical counts. Close the handoff; separately
   review cloud UI/reports, refresh and new-session recovery before requesting cutover.
   Original local records and recovery state remain unchanged. No local cleanup is implied.

## Failure, cancellation and retry

The four creates are not globally atomic. A cancellation, timeout, page close or loss of
acknowledgement may leave completed copies; an already in-flight transaction can finish.
No rollback deletion or overwrite occurs. Stop and review. An explicit same-snapshot retry
compares and skips identical copies and rejects changed ones. Never invent new IDs to
bypass a conflict. Cloud editing after a partial run can deliberately block retry.

Refresh, restart and page closure discard in-memory snapshots and all consent state.
They cannot resume automatically. Reconnect and obtain fresh explicit confirmations.
No acquisition data is put in localStorage, sessionStorage, IndexedDB, URLs, clipboard,
console, files, downloads or analytics by these handoff pages. Firebase retains existing
session auth and memory-only acquisition caching; this is not a new persistent cache.
The source baseline must be recaptured through the same reviewed action for a later retry.

## Limitations and remaining approval

Snapshots are validated as stored; no missing evidence, photos, assumptions or values are
invented. Valid media references do not guarantee future image loading. Keep browser-local
originals for rollback; after cloud editing starts, originals are only the migration baseline.
Same-origin compromise/extensions or a malicious local server are outside postMessage
origin protections. The development servers and Google popup must remain available.

Real Google OAuth/session continuity and the real four-record handoff still require founder
participation. Synthetic emulator testing cannot prove those live interactions. No real
acquisitions are read or transferred during preparation. Explicit founder approval is
required BEFORE the source snapshot action and actual transfer. No hosting, billing,
rules changes, deployment, commit, push, local cleanup or archive work is included.

## Synthetic browser verification

`tests/handoff.browser.ts` launches a fresh isolated Chrome context and uses fabricated
records only. It does not attach to the founder's profile. Source storage write APIs are
blocked and audited. Exact localhost origins exercise the real window/message binding.
Only the static receiver HTML is loaded from port 5176 so Chrome recognizes its loopback
address space; every receiver module is routed to a temporary cloud-emulator Vite server
on port 5178. The script asserts the demo project before emulator credential sign-in.
Non-loopback services and application API endpoints are blocked. No browser permissions
are granted or production authentication settings changed.

The test exercises declined and accepted source/receiver confirmations, no writes on
load/sign-in/receive/review, four complete server-readback comparisons, historical offset
envelopes, byte-for-byte unchanged complete source storage with a populated synthetic
recovery draft, no draft in received packets/cloud records, no draft writes/downloads, explicit identical retry,
and disabled automatic execution after refresh or direct receiver navigation.
Unit tests cover spoofed windows/origins/challenges, replay, expiry, changed source/auth,
cloud draft conflicts, independent local draft changes, records-only parser inputs,
ambiguous envelopes, interrupted transfers, and full-readback mismatch. Emulator rule tests
retain unauthorized-access and immutable revision/source-key coverage.
