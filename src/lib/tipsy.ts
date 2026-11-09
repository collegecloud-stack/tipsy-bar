export type MusicSource = "youtube" | "spotify";

export interface ParsedTrackUrl {
  source: MusicSource;
  sourceId: string;
  url: string;
  title: string;
}

export interface OrderedVote {
  id: string;
  position: number;
  voteCount: number;
  addedAt?: string;
  added_at?: string;
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: string;
}

export function parseTrackUrl(rawUrl: string): ParsedTrackUrl | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let youtubeId: string | null = null;
    if (host === "youtu.be") {
      youtubeId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") youtubeId = url.searchParams.get("v");
      else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
        youtubeId = url.pathname.split("/").filter(Boolean)[1] ?? null;
      }
    }

    if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
      return {
        source: "youtube",
        sourceId: youtubeId,
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        title: "YouTube track",
      };
    }

    if (host === "open.spotify.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const trackIndex = parts.findIndex((part) => part === "track");
      const spotifyId = trackIndex >= 0 ? parts[trackIndex + 1] : null;
      if (spotifyId && /^[A-Za-z0-9]{10,32}$/.test(spotifyId)) {
        return {
          source: "spotify",
          sourceId: spotifyId,
          url: `https://open.spotify.com/track/${spotifyId}`,
          title: "Spotify track",
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function orderQueueByVotes<T extends OrderedVote>(tracks: T[]): T[] {
  return [...tracks].sort((left, right) => {
    if (left.position === 0 || right.position === 0) return left.position - right.position;
    return (
      right.voteCount - left.voteCount ||
      left.position - right.position ||
      (left.addedAt ?? left.added_at ?? "").localeCompare(right.addedAt ?? right.added_at ?? "")
    );
  });
}

export function getSynchronizedPosition(snapshot: PlaybackSnapshot, nowMs: number): number {
  const elapsedSeconds = snapshot.isPlaying
    ? Math.max(0, (nowMs - Date.parse(snapshot.updatedAt)) / 1000)
    : 0;
  return Math.max(0, snapshot.positionSeconds + elapsedSeconds);
}

export function getYouTubeEmbedUrl(videoId: string, startSeconds: number, isPlaying = false): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  url.searchParams.set("autoplay", isPlaying ? "1" : "0");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("start", String(Math.max(0, Math.floor(startSeconds))));
  if (typeof window !== "undefined") url.searchParams.set("origin", window.location.origin);
  return url.toString();
}
/**
 * Queue model (positions live in room_tracks.position, no schema change needed):
 *   position  0  -> the track playing now
 *   position  >0 -> "Up next", ranked by votes
 *   position  <0 -> already played (history); never queued again automatically
 */
export function splitTracks<T extends OrderedVote>(tracks: T[]) {
  const current = tracks.find((track) => track.position === 0) ?? null;
  const upNext = orderQueueByVotes(tracks.filter((track) => track.position > 0));
  const played = tracks.filter((track) => track.position < 0).sort((a, b) => a.position - b.position);
  return { current, upNext, played };
}

/**
 * Plans the move to the next current track. The previous current track is archived
 * with a negative position instead of going back to the top of the queue.
 * Returns the full ordered id list and the position the first id should get, so a
 * single set_room_track_positions call can apply it atomically.
 */
export function planTrackAdvance<T extends OrderedVote>(tracks: T[], requestedId?: string) {
  const { current, upNext, played } = splitTracks(tracks);
  const requested = requestedId ? tracks.find((track) => track.id === requestedId) : undefined;
  const nextCurrent = requested ?? upNext[0] ?? current ?? played[played.length - 1] ?? null;
  if (!nextCurrent) return null;
  const retired = current && current.id !== nextCurrent.id ? [current] : [];
  const archive = [...played.filter((track) => track.id !== nextCurrent.id), ...retired];
  const rest = upNext.filter((track) => track.id !== nextCurrent.id);
  return {
    nextCurrent,
    orderedIds: [...archive, nextCurrent, ...rest].map((track) => track.id),
    startPosition: -archive.length,
  };
}
