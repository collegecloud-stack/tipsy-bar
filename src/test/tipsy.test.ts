import { describe, expect, it } from "vitest";

import { getSynchronizedPosition, orderQueueByVotes, parseTrackUrl, planTrackAdvance, splitTracks } from "@/lib/tipsy";

describe("Tipsy Bar room rules", () => {
  it("accepts YouTube and Spotify track links but rejects unsupported providers", () => {
    expect(parseTrackUrl("https://youtu.be/dQw4w9WgXcQ")?.sourceId).toBe("dQw4w9WgXcQ");
    expect(parseTrackUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")?.source).toBe("spotify");
    expect(parseTrackUrl("https://example.com/track/dQw4w9WgXcQ")).toBeNull();
  });

  it("keeps the current song first and ranks the remaining queue by votes", () => {
    const ordered = orderQueueByVotes([
      { id: "less", position: 2, voteCount: 1, addedAt: "2026-01-01T00:00:00Z" },
      { id: "current", position: 0, voteCount: 0, addedAt: "2026-01-01T00:00:00Z" },
      { id: "most", position: 3, voteCount: 4, addedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(ordered.map((track) => track.id)).toEqual(["current", "most", "less"]);
  });

  it("synchronizes room position from the saved timestamp without advancing paused tracks", () => {
    const started = { isPlaying: true, positionSeconds: 42, updatedAt: "2026-05-01T00:00:00.000Z" };
    expect(getSynchronizedPosition(started, Date.parse(started.updatedAt) + 6500)).toBeCloseTo(48.5);
    expect(
      getSynchronizedPosition({ ...started, isPlaying: false }, Date.parse(started.updatedAt) + 6500),
    ).toBe(42);
  });

  it("moves through the queue without ever replaying a finished song", () => {
    type T = { id: string; position: number; voteCount: number; added_at: string };
    let tracks: T[] = [
      { id: "a", position: 0, voteCount: 0, added_at: "2026-01-01T00:00:01Z" },
      { id: "b", position: 1, voteCount: 0, added_at: "2026-01-01T00:00:02Z" },
      { id: "c", position: 2, voteCount: 5, added_at: "2026-01-01T00:00:03Z" },
    ];
    const apply = (plan: { orderedIds: string[]; startPosition: number }) => {
      tracks = tracks.map((track) => ({ ...track, position: plan.startPosition + plan.orderedIds.indexOf(track.id) }));
    };
    const playedOrder: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      const next = splitTracks(tracks).upNext[0];
      expect(next).toBeDefined();
      const plan = planTrackAdvance(tracks, next?.id);
      expect(plan).not.toBeNull();
      if (plan) apply(plan);
      playedOrder.push(splitTracks(tracks).current?.id ?? "");
    }
    // c has the most votes so it goes first, then b; a (already played) never comes back.
    expect(playedOrder).toEqual(["c", "b"]);
    const { current, upNext, played } = splitTracks(tracks);
    expect(current?.id).toBe("b");
    expect(upNext).toEqual([]);
    expect(played.map((track) => track.id)).toEqual(["a", "c"]);
  });

  it("does not advance shared time while a newly selected track is paused", () => {
    const selectedTrack = { isPlaying: false, positionSeconds: 0, updatedAt: "2026-05-01T00:00:00.000Z" };
    expect(getSynchronizedPosition(selectedTrack, Date.parse(selectedTrack.updatedAt) + 15000)).toBe(0);
  });
});