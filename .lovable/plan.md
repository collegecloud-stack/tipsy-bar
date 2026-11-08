# Tipsy Bar collaborative listening rooms

## What to build
- Replace the `/` placeholder with a dark, neon-accented, mobile-first shared listening room: current track artwork, animated soundwave, queue drawer, room code/link, and live listener list.
- Let a host create a named room. Let anyone join from a room link/code using a nickname without creating an account. Keep an optional account path for people who want a saved profile.
- Persist room playback state, members, queue, votes, and track ordering in Lovable Cloud; publish room changes live and reconcile player time against the shared playback timestamp.
- Allow adding a YouTube link and Spotify link. Resolve safe public metadata where available and play YouTube via its official embedded player. Spotify links can show Spotify's official embed, but cannot be driven or precisely synchronized by the app.

## Playback and source limits
- Synchronization is best-effort and uses shared play/pause/seek state plus periodic timestamp correction for controllable YouTube embeds. Browsers, networks, background playback, and user gestures prevent a guarantee of sample-accurate synchronization or uninterrupted background audio.
- Do not extract, proxy, or redistribute music streams or bypass subscriptions/ads/DRM. Use official embeds and public metadata endpoints; YouTube search-by-text and Spotify catalog search require their respective authorized APIs, so the first version supports pasting links rather than promising catalog search.

## Implementation approach
- Enable optional email sign-in and Google/Lovable providers for saved profiles; guests remain able to use rooms by nickname.
- Add RLS-protected profiles and persistent room, membership, track, vote, and playback records with realtime enabled; use Cloud migrations and generated database types.
- Implement the public room experience at `/` and a shareable room URL, with reusable controls and an official YouTube iframe player.
- Add tests for queue ordering/voting and shared playback timestamp calculations, then verify the preview's guest create/join/add/vote/playback flow.

## Not included
- Stream extraction, paid-provider playback control, guaranteed background playback, and exact zero-drift audio synchronization.
- Spotify/YouTube account linking, catalog search requiring API credentials, native mobile packaging, and a production-grade abuse/rate-limit layer.
