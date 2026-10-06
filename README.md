# Fret Notes for Guitar / Bass

Browser-local fretboard training, hosted as an owner-only private Site.

- Instant Guitar / 4-string Bass / 5-string Bass switching; each instrument retains its settings.
- Position → note, note → position, and the full fretboard reference.
- 19 chord types and 21 scales; up to four mixed layers, with numbered color markers and per-note degree inspection.
- Root-position chord shapes on supported strings, with explicitly stated omissions.
- Keyboard practice and accessible modal close button, Escape, and backdrop click.
- Standard tunings; quizzes cover frets 0–12. Chord examples may extend to fret 15.

The hosted Sites access policy enforces authentication and owner-only access. There is no client-side password or public sharing link. The service worker retires older offline caches and leaves requests to the authenticated hosting layer.

## Checks

Run `node tests/theory.test.cjs`, `node tests/bass.test.cjs`, `node tests/shapes.test.cjs`, and `node tests/practice.test.cjs`.

Manual UI checks: both quiz directions, all-note map, each instrument and reload persistence, mixed layers and note inspection, chord shape modal (including a chord layered over a scale), backdrop dismissal, keyboard navigation, and mobile overflow.

Source changes are synchronized through the Sites workflow. Preserve the existing project identity in `.openai/hosting.json` and do not widen its access policy without the owner's explicit request.
