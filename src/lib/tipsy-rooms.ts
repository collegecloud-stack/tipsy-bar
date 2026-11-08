import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { getSynchronizedPosition, orderQueueByVotes } from "@/lib/tipsy";

export type TipsyRoom = Tables<"rooms">;
export type RoomMember = Tables<"room_members">;
export type RoomTrack = Tables<"room_tracks">;
export type RoomPlayback = Tables<"room_playback">;

export type QueueTrack = RoomTrack & { voteCount: number; hasVoted: boolean };

export interface RoomSnapshot {
  room: TipsyRoom;
  members: RoomMember[];
  tracks: QueueTrack[];
  playback: RoomPlayback | null;
}

const VISITOR_ID_KEY = "tipsy-bar-visitor-id";
const NICKNAME_KEY = "tipsy-bar-nickname";

export function getVisitorIdentity(): { visitorId: string; nickname: string } {
  let visitorId = window.localStorage.getItem(VISITOR_ID_KEY);
  if (!visitorId) {
    visitorId = window.crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }
  return { visitorId, nickname: window.localStorage.getItem(NICKNAME_KEY) ?? "" };
}

export function saveVisitorNickname(nickname: string): void {
  window.localStorage.setItem(NICKNAME_KEY, nickname.trim());
}

export async function createRoom(name: string, nickname: string, visitorId: string) {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert({ name: name.trim() })
    .select()
    .single();
  if (roomError) throw roomError;

  const joined = await joinRoom(room.code, nickname, visitorId);
  if (!joined) throw new Error("The room was created, but your nickname could not join it.");
  const { error: hostError } = await supabase
    .from("rooms")
    .update({ host_member_id: joined.member.id })
    .eq("id", room.id);
  if (hostError) throw hostError;
  const { error: playbackError } = await supabase
    .from("room_playback")
    .upsert({ room_id: room.id, track_id: null, is_playing: false, position_seconds: 0 });
  if (playbackError) throw playbackError;

  return { room, member: joined.member };
}

export async function joinRoom(code: string, nickname: string, visitorId: string) {
  const normalizedNickname = nickname.trim().slice(0, 32);
  if (!normalizedNickname) throw new Error("Add a nickname before joining the room.");
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;

  const { data: member, error: memberError } = await supabase
    .from("room_members")
    .upsert(
      {
        room_id: room.id,
        visitor_id: visitorId,
        nickname: normalizedNickname,
        joined_at: new Date().toISOString(),
      },
      { onConflict: "room_id,visitor_id" },
    )
    .select()
    .single();
  if (memberError) throw memberError;

  const { error: playbackError } = await supabase
    .from("room_playback")
    .upsert({ room_id: room.id, track_id: null, is_playing: false, position_seconds: 0 }, { onConflict: "room_id", ignoreDuplicates: true });
  if (playbackError) throw playbackError;
  return { room, member };
}

export async function getRoomSnapshot(code: string, visitorId: string): Promise<RoomSnapshot | null> {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;

  const [membersResult, tracksResult, votesResult, playbackResult] = await Promise.all([
    supabase.from("room_members").select("*").eq("room_id", room.id).order("joined_at"),
    supabase.from("room_tracks").select("*").eq("room_id", room.id).order("position").order("added_at"),
    supabase.from("track_votes").select("track_id,voter_id").eq("room_id", room.id),
    supabase.from("room_playback").select("*").eq("room_id", room.id).maybeSingle(),
  ]);
  const error = membersResult.error ?? tracksResult.error ?? votesResult.error ?? playbackResult.error;
  if (error) throw error;

  const trackVotes = new Map<string, number>();
  const visitorVotes = new Set<string>();
  for (const vote of votesResult.data ?? []) {
    trackVotes.set(vote.track_id, (trackVotes.get(vote.track_id) ?? 0) + 1);
    if (vote.voter_id === visitorId) visitorVotes.add(vote.track_id);
  }

  return {
    room,
    members: membersResult.data ?? [],
    tracks: (tracksResult.data ?? []).map((track) => ({
      ...track,
      voteCount: trackVotes.get(track.id) ?? 0,
      hasVoted: visitorVotes.has(track.id),
    })),
    playback: playbackResult.data,
  };
}

export async function addTrack(
  roomId: string,
  memberId: string,
  track: Omit<TablesInsert<"room_tracks">, "room_id" | "added_by" | "position">,
) {
  const { data: currentTracks, error: listError } = await supabase
    .from("room_tracks")
    .select("position")
    .eq("room_id", roomId);
  if (listError) throw listError;
  const position = Math.max(0, ...((currentTracks ?? []).map((item) => item.position))) + 1;
  const { error } = await supabase.from("room_tracks").insert({
    ...track,
    room_id: roomId,
    added_by: memberId,
    position,
  });
  if (error) throw error;
}

export async function toggleTrackVote(roomId: string, trackId: string, visitorId: string, hasVoted: boolean) {
  const query = hasVoted
    ? supabase.from("track_votes").delete().eq("room_id", roomId).eq("track_id", trackId).eq("voter_id", visitorId)
    : supabase.from("track_votes").insert({ room_id: roomId, track_id: trackId, voter_id: visitorId });
  const { error } = await query;
  if (error) throw error;
}

export async function savePlayback(roomId: string, trackId: string | null, isPlaying: boolean, positionSeconds: number) {
  const { data, error } = await supabase.from("room_playback").upsert({
    room_id: roomId,
    track_id: trackId,
    is_playing: isPlaying,
    position_seconds: Math.max(0, positionSeconds),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function chooseCurrentTrack(roomId: string, tracks: QueueTrack[], requestedTrackId?: string) {
  const ranked = orderQueueByVotes(tracks);
  const current = requestedTrackId ? ranked.find((track) => track.id === requestedTrackId) : undefined;
  const nextCurrent = current ?? ranked.find((track) => track.position !== 0) ?? ranked[0];
  const rest = ranked.filter((track) => track.id !== nextCurrent?.id);
  const updates = [
    ...(nextCurrent ? [{ ...nextCurrent, position: 0 }] : []),
    ...rest.map((track, index) => ({ ...track, position: index + 1 })),
  ];

  for (const track of updates) {
    const { error } = await supabase.from("room_tracks").update({ position: track.position }).eq("id", track.id);
    if (error) throw error;
  }

  await savePlayback(roomId, nextCurrent?.id ?? null, Boolean(nextCurrent), 0);
}

export async function moveQueueTrack(roomId: string, tracks: QueueTrack[], trackId: string, offset: -1 | 1) {
  const ordered = orderQueueByVotes(tracks).filter((track) => track.position !== 0);
  const index = ordered.findIndex((track) => track.id === trackId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  for (const [position, track] of ordered.entries()) {
    const { error } = await supabase.from("room_tracks").update({ position: position + 1 }).eq("id", track.id);
    if (error) throw error;
  }
}

export function playbackPosition(playback: RoomPlayback | null, nowMs: number): number {
  if (!playback) return 0;
  return getSynchronizedPosition(
    {
      isPlaying: playback.is_playing,
      positionSeconds: playback.position_seconds,
      updatedAt: playback.updated_at,
    },
    nowMs,
  );
}