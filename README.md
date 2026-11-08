# Tipsy Bar

Build Tipsy Bar, a real-time collaborative music listening room app for friends across cities (a seamless, reliable alternative to Spotify Jam).

Key requirements:
1. Persistent Cloud Queue: Sessions where the queue is stored in the database so it never resets or disappears if someone disconnects, switches apps, or plays audio in another app. Anyone in the room can add tracks, reorder, and vote.
2. Synchronized Room Playback: Time-synced audio across all listeners so everyone hears the same beat at the same timestamp without clock drift.
3. Multi-Source / Free Audio Stream Integration: Support searching tracks and pasting Spotify or YouTube URLs, inspired by Freefy (https://freefy.app/) and Spotube (https://github.com/team-spotube/spotube) where Spotify-style metadata and album art are matched with free audio streams (YouTube/audio embeds) so friends without Spotify Premium can listen seamlessly.
4. Room Creation & Quick Mobile Join: Host can create a room, name it, and share an invite link or room code; friends can join immediately on their phones with just a nickname.
5. Dark Neon 'Tipsy Bar' Mobile UI: A sleek lounge/bar-inspired dark music player theme with active track artwork, animated soundwave visualizer, upvotable queue drawer, and live room listener indicators.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://tipsy-bar.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/34b7d963-3e84-4fc2-b63b-ddc1d190ac43).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
