import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Clipboard,
  Disc3,
  Headphones,
  Link2,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Share2,
  ThumbsUp,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import featuredCover from "@/assets/tipsy-featured-cover.jpg";
import { Button } from "@/components/ui/button";
import {
  addTrack,
  chooseCurrentTrack,
  createRoom,
  getVisitorIdentity,
  joinRoom,
  moveQueueTrack,
  playbackPosition,
  savePlayback,
  saveVisitorNickname,
  getRoomSnapshot,
  toggleTrackVote,
  type QueueTrack,
  type RoomMember,
  type RoomPlayback,
  type TipsyRoom,
} from "@/lib/tipsy-rooms";
import { parseTrackUrl, splitTracks } from "@/lib/tipsy";
import { loadYouTubeIframeApi, type YTPlayer } from "@/lib/youtube-iframe-api";
import { supabase } from "@/integrations/supabase/client";
import { SpotifyLibrary, useSpotifyConnected } from "@/components/spotify-library";
import { remotePause, remotePlay, type SpotifyTrackItem } from "@/lib/spotify";

type Visitor = { id: string; nickname: string };
type PresenceMember = { visitor_id?: string; nickname?: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

interface TipsyAppProps {
  initialRoomCode?: string;
}

function getStoredCover(track: QueueTrack | null) {
  return track?.artwork_url || featuredCover;
}

function formatClock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

function Waveform({ playing }: { playing: boolean }) {
  return (
    <div className={`waveform ${playing ? "waveform-playing" : ""}`} aria-label={playing ? "Music playing" : "Playback paused"}>
      {Array.from({ length: 34 }, (_, index) => (
        <span
          key={index}
          style={{
            "--wave-index": index,
            height: `${8 + ((index * 19) % 17)}px`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function TipsyApp({ initialRoomCode = "" }: TipsyAppProps) {
  const navigate = useNavigate();
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode.toUpperCase());
  const [room, setRoom] = useState<TipsyRoom | null>(null);
  const [member, setMember] = useState<RoomMember | null>(null);
  const [tracks, setTracks] = useState<QueueTrack[]>([]);
  const [playback, setPlayback] = useState<RoomPlayback | null>(null);
  const [listeners, setListeners] = useState<PresenceMember[]>([]);
  const [trackUrl, setTrackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(Boolean(initialRoomCode));
  const [queueOpen, setQueueOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoRef = useRef<string | null>(null);
  const lastSeekAtRef = useRef(0);
  const handleVideoEndedRef = useRef<() => void>(() => {});
  const enterRoomRef = useRef<(code: string, name: string, identity: Visitor) => Promise<void>>(async () => {});

  // position 0 = playing now, > 0 = up next (by votes), < 0 = already played
  const { current: currentTrack, upNext: queueTracks } = useMemo(() => splitTracks(tracks), [tracks]);
  const positionSeconds = playbackPosition(playback, nowMs);
  const isPlaying = playback?.is_playing ?? false;
  const isYoutubeTrack = currentTrack?.source === "youtube";
  const spotifyConnected = useSpotifyConnected();
  const spotifyRemoteKeyRef = useRef("");

  // Spotify remote: when the room's state changes, tell this listener's own Spotify app to match it.
  useEffect(() => {
    if (!spotifyConnected || !playback) return;
    const isSpotify = currentTrack?.source === "spotify";
    const key = `${currentTrack?.id ?? ""}|${playback.is_playing}|${playback.updated_at}`;
    if (spotifyRemoteKeyRef.current === key) return;
    const previous = spotifyRemoteKeyRef.current;
    spotifyRemoteKeyRef.current = key;
    if (isSpotify && playback.is_playing && currentTrack) {
      const seconds = playbackPosition(playback, Date.now());
      remotePlay(currentTrack.source_id, seconds * 1000).catch((error: Error) => toast.error(error.message));
    } else if (previous) {
      void remotePause();
    }
  }, [spotifyConnected, currentTrack, playback]);

  useEffect(() => {
    const identity = getVisitorIdentity();
    setIsIosDevice(/iPhone|iPad|iPod/.test(navigator.userAgent));
    setVisitor({ id: identity.visitorId, nickname: identity.nickname });
    setNickname(identity.nickname);
    setNowMs(Date.now());
    if (!initialRoomCode || !identity.nickname.trim()) setLoadingRoom(false);
  }, [initialRoomCode]);

  useEffect(() => {
    const handleInstallAvailable = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallAvailable);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallAvailable);
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
      } finally {
        setInstallPrompt(null);
      }
      return;
    }
    toast.info("On iPhone or iPad, tap Share, then Add to Home Screen.", {
      description: "Screen-off playback depends on the music app and browser; it isn’t guaranteed here.",
    });
  };

  const enterRoom = useCallback(async (code: string, name: string, identity: Visitor) => {
    setErrorMessage("");
    setBusy(true);
    setLoadingRoom(true);
    try {
      const joined = await joinRoom(code, name, identity.id);
      if (!joined) {
        setErrorMessage("We couldn't find that room. Check the code and try again.");
        return;
      }
      saveVisitorNickname(name);
      setVisitor({ id: identity.id, nickname: name.trim() });
      setNickname(name.trim());
      setRoomCodeInput(joined.room.code);
      setRoom(joined.room);
      setMember(joined.member);
      setRoomName(joined.room.name);
      const snapshot = await getRoomSnapshot(joined.room.code, identity.id);
      if (snapshot) {
        setTracks(snapshot.tracks);
        setPlayback(snapshot.playback);
      }
      void navigate({ to: "/room/$code", params: { code: joined.room.code } });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "That room couldn't open just now.");
    } finally {
      setLoadingRoom(false);
      setBusy(false);
    }
  }, [navigate]);

  enterRoomRef.current = enterRoom;

  // Monotonic request counter: only the newest snapshot request may write state.
  const snapshotRequestRef = useRef(0);
  const latestAppliedRef = useRef(0);
  const fetchSnapshot = async () => {
    const requestId = ++snapshotRequestRef.current;
    const snapshot = room ? await getRoomSnapshot(room.code, visitor?.id ?? "") : null;
    return { requestId, snapshot };
  };
  const applySnapshot = (
    result: { requestId: number; snapshot: Awaited<ReturnType<typeof getRoomSnapshot>> },
    parts: Array<"room" | "tracks" | "playback">,
  ) => {
    if (!result.snapshot || result.requestId < latestAppliedRef.current) return false;
    latestAppliedRef.current = result.requestId;
    if (parts.includes("room")) {
      setRoom(result.snapshot.room);
      setRoomName(result.snapshot.room.name);
    }
    if (parts.includes("tracks")) setTracks(result.snapshot.tracks);
    if (parts.includes("playback")) setPlayback(result.snapshot.playback);
    return true;
  };

  useEffect(() => {
    if (!initialRoomCode || !visitor || !visitor.nickname.trim()) return;
    void enterRoomRef.current(initialRoomCode, visitor.nickname, visitor);
  }, [initialRoomCode, visitor?.id]);

  useEffect(() => {
    if (!room || !visitor) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      try {
        const result = await fetchSnapshot();
        if (!active) return;
        applySnapshot(result, ["room", "tracks", "playback"]);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : "Couldn't refresh the room.");
      }
    };
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };

    const channel = supabase
      .channel(`tipsy-room-${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_tracks", filter: `room_id=eq.${room.id}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "track_votes", filter: `room_id=eq.${room.id}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_playback", filter: `room_id=eq.${room.id}` }, scheduleRefresh)
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMember>();
        const unique = new Map<string, PresenceMember>();
        Object.values(state).flat().forEach((person) => {
          if (person.visitor_id) unique.set(person.visitor_id, person);
        });
        setListeners([...unique.values()]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ visitor_id: visitor.id, nickname: visitor.nickname });
        }
      });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.code, visitor?.id, visitor?.nickname]);

  useEffect(() => {
    if (!room) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [room]);

  // When a YouTube song ends, move the room to the next queued song. Every device sees the
  // end, so one "leader" (lowest visitor id in the room) advances right away; the others wait
  // and only step in if the room still hasn't moved on, so a song is never skipped twice.
  const handleVideoEnded = () => {
    const ended = currentTrack;
    if (!room || !visitor || !ended) return;
    const ids = [visitor.id, ...listeners.map((person) => person.visitor_id).filter((id): id is string => Boolean(id))];
    const leaderId = [...ids].sort()[0];
    const delay = leaderId === visitor.id ? 0 : 10000 + Math.random() * 1000;
    window.setTimeout(() => {
      void (async () => {
        try {
          const snapshot = await getRoomSnapshot(room.code, visitor.id);
          if (!snapshot) return;
          const { current, upNext } = splitTracks(snapshot.tracks);
          if (!current || current.id !== ended.id) return; // someone else already moved on
          const next = upNext[0];
          if (next) await chooseCurrentTrack(room.id, snapshot.tracks, next.id, { autoplay: true });
          else await savePlayback(room.id, current.id, false, 0);
          applySnapshot(await fetchSnapshot(), ["tracks", "playback"]);
        } catch {
          // The Next button still works if auto-advance fails.
        }
      })();
    }, delay);
  };
  handleVideoEndedRef.current = handleVideoEnded;

  // One persistent official YouTube player. It is created once and never reloaded for
  // play, pause or seek; track changes use loadVideoById.
  useEffect(() => {
    if (!isYoutubeTrack) return;
    let cancelled = false;
    let created = null as YTPlayer | null;
    setPlayerReady(false);
    loadedVideoRef.current = null;
    loadYouTubeIframeApi()
      .then((YT) => {
        const host = playerHostRef.current;
        if (cancelled || !host) return;
        host.innerHTML = "";
        const mount = document.createElement("div");
        host.appendChild(mount);
        created = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              setPlayerReady(true);
            },
            onStateChange: (event) => {
              if (event.data === 1) setNeedsTap(false);
              if (event.data === 0) handleVideoEndedRef.current();
            },
            onError: () => {
              toast.error("This video can't be played here. Use Next to skip it.");
            },
          },
        });
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "The YouTube player couldn't load.");
      });
    return () => {
      cancelled = true;
      playerRef.current = null;
      setPlayerReady(false);
      setNeedsTap(false);
      try {
        created?.destroy();
      } catch {
        // Player already gone.
      }
      if (playerHostRef.current) playerHostRef.current.innerHTML = "";
    };
  }, [isYoutubeTrack]);

  // A new playback row from the room is a command: play, pause, load a track, or seek.
  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player || !currentTrack || currentTrack.source !== "youtube") return;
    if (playback && playback.track_id !== currentTrack.id) return; // wait for the matching playback row
    const expected = playbackPosition(playback, Date.now());
    if (loadedVideoRef.current !== currentTrack.source_id) {
      loadedVideoRef.current = currentTrack.source_id;
      lastSeekAtRef.current = Date.now();
      if (isPlaying) player.loadVideoById({ videoId: currentTrack.source_id, startSeconds: expected });
      else player.cueVideoById({ videoId: currentTrack.source_id, startSeconds: expected });
    } else if (isPlaying) {
      if (Math.abs(player.getCurrentTime() - expected) > 2) {
        player.seekTo(expected, true);
        lastSeekAtRef.current = Date.now();
      }
      player.playVideo();
    } else {
      player.pauseVideo();
      const resumeAt = playback?.position_seconds ?? 0;
      if (Math.abs(player.getCurrentTime() - resumeAt) > 2) player.seekTo(resumeAt, true);
    }
    if (!isPlaying) return;
    // Phones can block autoplay without a tap: offer one clear button instead of silence.
    const timer = window.setTimeout(() => {
      const state = playerRef.current?.getPlayerState();
      if (state !== undefined && state !== 1 && state !== 3) setNeedsTap(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [playerReady, currentTrack?.id, currentTrack?.source_id, playback?.updated_at, isPlaying]);

  // Gentle drift correction between commands. Smooth audio beats tight sync: only act when
  // clearly off, never while buffering, and at most once every 30 seconds.
  useEffect(() => {
    if (!playerReady || !isPlaying || !isYoutubeTrack) return;
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !playback || playback.track_id !== currentTrack?.id) return;
      if (player.getPlayerState() !== 1) return;
      if (Date.now() - lastSeekAtRef.current < 30000) return;
      const expected = playbackPosition(playback, Date.now());
      if (Math.abs(player.getCurrentTime() - expected) > 8) {
        player.seekTo(expected, true);
        lastSeekAtRef.current = Date.now();
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [playerReady, isPlaying, isYoutubeTrack, playback?.updated_at, currentTrack?.id]);

  // Keep the screen awake while music plays so the phone doesn't lock mid-song.
  // (It can't keep audio going if you lock the phone yourself or switch apps.)
  useEffect(() => {
    if (!room || !isPlaying) return;
    type WakeLockSentinelLike = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLock) return;
    let cancelled = false;
    let sentinel = null as WakeLockSentinelLike | null;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          void lock.release().catch(() => {});
          return;
        }
        void sentinel?.release().catch(() => {});
        sentinel = lock;
      } catch {
        // Wake lock is a nice-to-have.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [room?.id, isPlaying]);

  const createNewRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!visitor) return;
    setErrorMessage("");
    setBusy(true);
    try {
      const roomTitle = roomName.trim() || "The listening room";
      const name = nickname.trim();
      if (!name) throw new Error("Add a nickname before starting the room.");
      const created = await createRoom(roomTitle, name, visitor.id);
      saveVisitorNickname(name);
      setVisitor({ id: visitor.id, nickname: name });
      setRoomName(created.room.name);
      setRoom(created.room);
      setMember(created.member);
      setLoadingRoom(false);
      void navigate({ to: "/room/$code", params: { code: created.room.code } });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The room couldn't be created.");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!visitor) return;
    await enterRoom(roomCodeInput, nickname, visitor);
  };

  const togglePlayback = async () => {
    if (!room || !currentTrack) return;
    const nextState = !isPlaying;
    const player = isYoutubeTrack && playerReady ? playerRef.current : null;
    let position = positionSeconds;
    if (player) {
      // Called straight from the tap, so phones allow the audio to start.
      if (nextState) {
        player.playVideo();
        setNeedsTap(false);
      } else {
        if (player.getPlayerState() === 1) position = player.getCurrentTime(); // pause where you really are
        player.pauseVideo();
      }
    }
    try {
      await savePlayback(room.id, currentTrack.id, nextState, position);
      applySnapshot(await fetchSnapshot(), ["playback"]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Playback couldn't update for the room.");
    }
  };

  const startAudio = () => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(playbackPosition(playback, Date.now()), true);
    lastSeekAtRef.current = Date.now();
    player.playVideo();
    setNeedsTap(false);
  };

  const skipToNext = async () => {
    if (!room) return;
    try {
      const next = queueTracks[0];
      if (next) {
        await chooseCurrentTrack(room.id, tracks, next.id, { autoplay: true });
        applySnapshot(await fetchSnapshot(), ["tracks", "playback"]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The next song couldn't start.");
    }
  };

  const handleAddTrack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!room || !member || !trackUrl.trim()) return;
    const parsed = parseTrackUrl(trackUrl);
    if (!parsed) {
      toast.error("Paste a valid YouTube or Spotify track link.");
      return;
    }
    setBusy(true);
    try {
      let title = parsed.title;
      let artist = "Added by " + (visitor?.nickname ?? "a listener");
      let artworkUrl = parsed.source === "youtube" ? `https://i.ytimg.com/vi/${parsed.sourceId}/hqdefault.jpg` : null;
      try {
        const embed = new URL("https://www.youtube.com/oembed");
        embed.searchParams.set("url", parsed.url);
        embed.searchParams.set("format", "json");
        const endpoint = parsed.source === "youtube" ? embed : new URL("https://open.spotify.com/oembed");
        if (parsed.source === "spotify") endpoint.searchParams.set("url", parsed.url);
        const response = await fetch(endpoint);
        if (response.ok) {
          const metadata = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
          title = metadata.title || title;
          artist = metadata.author_name || artist;
          artworkUrl = metadata.thumbnail_url || artworkUrl;
        }
      } catch {
        // Public metadata is optional: a valid provider link still works without it.
      }
      await addTrack(room.id, member.id, {
        source: parsed.source,
        source_id: parsed.sourceId,
        track_url: parsed.url,
        title,
        artist,
        artwork_url: artworkUrl,
      });
      setTrackUrl("");
      toast.success("Added to the room queue.");
      const latest = await fetchSnapshot();
      if (latest.snapshot) {
        if (!latest.snapshot.tracks.some((track) => track.position === 0)) {
          await chooseCurrentTrack(room.id, latest.snapshot.tracks);
        }
        applySnapshot(await fetchSnapshot(), ["tracks", "playback"]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This track couldn't be added.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddSpotifyTracks = async (items: SpotifyTrackItem[]) => {
    if (!room || !member) return;
    try {
      for (const item of items) {
        await addTrack(room.id, member.id, {
          source: "spotify",
          source_id: item.id,
          track_url: item.url,
          title: item.title,
          artist: item.artist,
          artwork_url: item.artworkUrl,
        });
      }
      toast.success(items.length === 1 ? "Added to the room queue." : `Added ${items.length} songs to the room queue.`);
      const latest = await fetchSnapshot();
      if (latest.snapshot && !latest.snapshot.tracks.some((track) => track.position === 0)) {
        await chooseCurrentTrack(room.id, latest.snapshot.tracks);
      }
      applySnapshot(await fetchSnapshot(), ["tracks", "playback"]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "These songs couldn't be added.");
    }
  };

  const handleVote = async (track: QueueTrack) => {
    if (!room || !visitor) return;
    try {
      await toggleTrackVote(room.id, track.id, visitor.id, track.hasVoted);
      applySnapshot(await fetchSnapshot(), ["tracks"]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your vote couldn't be saved.");
    }
  };

  const handleMove = async (track: QueueTrack, offset: -1 | 1) => {
    if (!room) return;
    try {
      await moveQueueTrack(room.id, tracks, track.id, offset);
      applySnapshot(await fetchSnapshot(), ["tracks"]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The queue order couldn't change.");
    }
  };

  const handleInvite = async () => {
    if (!room) return;
    const inviteUrl = `${window.location.origin}/room/${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: `${room.name} · Tipsy Bar`, url: inviteUrl });
      else {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        toast.success("Invite link copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        toast.success("Invite link copied.");
      } catch {
        toast.error("Couldn't copy the invite link.");
      }
    }
  };

  const leaveRoom = () => {
    setRoom(null);
    setMember(null);
    setTracks([]);
    setPlayback(null);
    setListeners([]);
    setQueueOpen(false);
    setErrorMessage("");
    void navigate({ to: "/" });
  };

  const inviteButton = room ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleInvite()}
      className="h-10 border-line bg-panel px-3 text-foreground hover:border-neon/50 hover:bg-panel-raised"
      aria-label="Share the room invite"
    >
      {copied ? <Check /> : <Share2 />}
      <span className="hidden sm:inline">Invite</span>
    </Button>
  ) : null;

  const queueContent = (
    <section aria-label="Room queue" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neon">Up next</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">The queue <span className="text-sm font-medium text-muted-foreground">{queueTracks.length}</span></h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setQueueOpen(false)}
          className="text-muted-foreground hover:text-foreground xl:hidden"
          aria-label="Close queue"
        ><X /></Button>
      </div>

      <form onSubmit={handleAddTrack} className="flex gap-2 border-b border-line p-3 sm:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-background px-3 focus-within:border-neon/60">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="YouTube or Spotify link"
            type="url"
            inputMode="url"
            placeholder="Paste a YouTube or Spotify link"
            value={trackUrl}
            onChange={(event) => setTrackUrl(event.target.value)}
            className="h-11 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Button type="submit" disabled={busy || !trackUrl.trim()} size="icon" aria-label="Add song" title="Add song" className="h-11 w-11 shrink-0 rounded-md bg-neon text-night hover:bg-neon/85">
          {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
        </Button>
      </form>

      <SpotifyLibrary onAdd={handleAddSpotifyTracks} />

      <div className="queue-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {queueTracks.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center px-4 text-center">
            <Music2 className="mb-3 h-6 w-6 text-neon" />
            <p className="text-sm font-medium text-foreground">Nothing queued yet</p>
            <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">Add a link and let the room choose what comes next.</p>
          </div>
        ) : (
          queueTracks.map((track, index) => (
            <article key={track.id} className="group flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-panel-raised">
              <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <img src={getStoredCover(track)} alt="" width={44} height={44} loading="lazy" className="h-11 w-11 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{track.title}</p>
                <p className="truncate text-xs text-muted-foreground">{track.artist} <span className="px-1">·</span>{track.source === "youtube" ? "YouTube" : "Spotify"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button variant="ghost" size="icon" onClick={() => void handleMove(track, -1)} disabled={index === 0} className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={`Move ${track.title} up`} title="Move up"><ArrowUp /></Button>
                <Button variant="ghost" size="icon" onClick={() => void handleMove(track, 1)} disabled={index === queueTracks.length - 1} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground sm:inline-flex" aria-label={`Move ${track.title} down`} title="Move down"><ArrowDown /></Button>
                <Button variant="ghost" size="sm" onClick={() => void handleVote(track)} className={`h-9 min-w-11 gap-1 px-2 ${track.hasVoted ? "text-neon" : "text-muted-foreground hover:text-neon"}`} aria-label={`${track.hasVoted ? "Remove vote from" : "Upvote"} ${track.title}`} aria-pressed={track.hasVoted} title="Upvote track"><ThumbsUp className="h-4 w-4" /><span className="text-xs tabular-nums">{track.voteCount}</span></Button>
              </div>
            </article>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[11px] text-muted-foreground">
        <AudioLines className="h-4 w-4 text-aqua" /> Votes move favorites up; use arrows for the order.
      </div>
    </section>
  );

  if (room && visitor) {
    const activeListeners = listeners.length ? listeners : [{ visitor_id: visitor.id, nickname: visitor.nickname }];
    return (
      <main className="tipsy-shell min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-line/80 bg-background/95 backdrop-blur-xl">
          <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-8">
            <Button type="button" variant="ghost" onClick={leaveRoom} className="group flex h-auto min-w-0 items-center justify-start gap-3 p-0 text-left hover:bg-transparent" aria-label="Back to Tipsy Bar home">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-neon/30 bg-neon/10 text-neon"><Disc3 className="h-5 w-5" /></span>
              <span className="hidden min-w-0 sm:block">
                <span className="block text-sm font-extrabold tracking-normal text-foreground">TIPSY <span className="text-neon">BAR</span></span>
                <span className="block truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Good music, better company</span>
              </span>
            </Button>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-xs font-semibold text-foreground">
                <span className="live-dot" /> Live room
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void handleInvite()} className="hidden h-10 items-center gap-2 border-line bg-panel px-3 text-xs font-bold uppercase text-foreground transition-colors hover:border-neon/40 sm:flex" aria-label="Copy room code and invite link">
                <span className="text-muted-foreground">CODE</span><span className="font-mono text-neon">{room.code}</span><Clipboard className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              {inviteButton}
              <Button variant="ghost" size="icon" onClick={leaveRoom} className="text-muted-foreground hover:text-foreground" aria-label="Leave room"><ArrowLeft /></Button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid min-h-[calc(100svh-69px)] max-w-[1320px] grid-cols-1 items-start gap-8 px-4 pb-32 pt-6 sm:px-8 sm:pt-8 xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-12 xl:pb-12">
          <section className="mx-auto flex w-full max-w-[760px] flex-col items-center xl:pt-1">
            <div className="mb-5 flex w-full flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-neon"><Radio className="h-3.5 w-3.5" /> Now playing in</div>
                <h1 className="mt-1 max-w-[65vw] truncate text-xl font-bold text-foreground sm:text-2xl">{room.name}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel px-3 py-2">
                <UsersRound className="h-4 w-4 text-aqua" />
                <span className="text-xs font-semibold tabular-nums text-foreground">{activeListeners.length}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">listening</span>
                <div className="ml-1 flex -space-x-2">
                  {activeListeners.slice(0, 3).map((listener, index) => (
                    <span key={listener.visitor_id ?? index} title={listener.nickname} className={`grid h-6 w-6 place-items-center rounded-full border-2 border-background text-[9px] font-bold text-night ${index % 2 ? "bg-aqua" : "bg-neon"}`}>{(listener.nickname || "?").slice(0, 1).toUpperCase()}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="now-playing-grid w-full overflow-hidden rounded-xl border border-line bg-panel p-4 shadow-2xl sm:p-6">
              <div className="mx-auto w-full max-w-[390px]">
                <div className="cover-wrap relative aspect-square overflow-hidden rounded-lg bg-surface">
                  <img src={getStoredCover(currentTrack)} alt={currentTrack ? `Artwork for ${currentTrack.title}` : "Tipsy Bar featured cover"} width={1200} height={1200} className="h-full w-full object-cover" fetchPriority="high" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-night/90 to-transparent" />
                  <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-2">
                    <span className="flex items-center gap-2 rounded-full border border-white/15 bg-night/55 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground backdrop-blur-sm">
                      <AudioLines className="h-3.5 w-3.5 text-neon" /> {currentTrack ? (isPlaying ? "On the turntable" : "Ready when you are") : "Your room, your soundtrack"}
                    </span>
                    <span className="rounded-full border border-white/15 bg-night/55 px-3 py-1.5 text-[10px] font-bold text-foreground backdrop-blur-sm">{currentTrack?.source === "spotify" ? "SPOTIFY" : "TIPSY SELECTS"}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-2xl font-extrabold tracking-normal text-foreground sm:text-3xl">{currentTrack?.title ?? "The room is yours"}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{currentTrack?.artist ?? "Add a track to set the mood"}</p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 rounded-md border border-line px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Everyone's queue
                </div>
              </div>

              {currentTrack?.source === "youtube" ? (
                <div className="mt-5 overflow-hidden rounded-md border border-line bg-background">
                  <div ref={playerHostRef} role="region" aria-label={`YouTube player for ${currentTrack.title}`} className="aspect-video w-full [&>iframe]:h-full [&>iframe]:w-full" />
                </div>
              ) : currentTrack?.source === "spotify" ? (
                <div className="mt-5 overflow-hidden rounded-md border border-line bg-background">
                  <iframe title={`Spotify player for ${currentTrack.title}`} src={`https://open.spotify.com/embed/track/${currentTrack.source_id}?theme=0`} className="h-[152px] w-full border-0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
                </div>
              ) : (
                <div className="mt-5 grid aspect-video place-items-center rounded-md border border-dashed border-line bg-background/70 text-center">
                  <div><Headphones className="mx-auto h-8 w-8 text-neon" /><p className="mt-2 text-sm font-semibold text-foreground">A song away from a good time</p><p className="mt-1 text-xs text-muted-foreground">Drop a YouTube or Spotify link into the queue.</p></div>
                </div>
              )}

              {needsTap && isPlaying && currentTrack?.source === "youtube" ? (
                <Button onClick={startAudio} className="mt-4 h-12 w-full rounded-md bg-neon text-sm font-extrabold text-night hover:bg-neon/85">
                  <Play className="fill-current" /> Tap to start audio
                </Button>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-4 text-xs tabular-nums text-muted-foreground">
                <span>{formatClock(positionSeconds)}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-label="Shared playback position">
                  <span className="block h-full rounded-full bg-neon transition-[width] duration-1000" style={{ width: currentTrack?.duration_seconds ? `${Math.min(100, (positionSeconds / currentTrack.duration_seconds) * 100)}%` : isPlaying ? "34%" : "0%" }} />
                </div>
                <span>{currentTrack?.duration_seconds ? formatClock(currentTrack.duration_seconds) : "—:—"}</span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="hidden sm:block"><Waveform playing={isPlaying} /></div>
                <div className="flex w-full items-center justify-center gap-4 sm:w-auto sm:justify-end">
                  <Button variant="ghost" size="icon" onClick={() => {
                    if (currentTrack && room) void savePlayback(room.id, currentTrack.id, isPlaying, 0).then(() => setPlayback({ room_id: room.id, track_id: currentTrack.id, is_playing: isPlaying, position_seconds: 0, updated_at: new Date().toISOString() }));
                  }} disabled={!currentTrack || currentTrack.source !== "youtube"} className="h-11 w-11 text-muted-foreground hover:text-foreground" aria-label="Restart current track" title="Restart track"><Music2 /></Button>
                  <Button onClick={() => void togglePlayback()} disabled={!currentTrack} size="icon" className="h-[58px] w-[58px] rounded-full bg-neon text-night shadow-[0_0_28px_var(--color-neon-glow)] hover:bg-neon/85" aria-label={isPlaying ? "Pause shared playback" : "Start shared playback"} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-1 h-6 w-6 fill-current" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void skipToNext()} disabled={queueTracks.length === 0} className="h-11 w-11 text-muted-foreground hover:text-foreground" aria-label="Play next song" title="Next track"><ChevronDown className="-rotate-90" /></Button>
                </div>
                <div className="hidden min-w-[132px] justify-end sm:flex">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setQueueOpen(true)} className="h-9 gap-2 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><Music2 className="h-4 w-4 text-neon" /> {queueTracks.length} up next</Button>
                </div>
              </div>
              {currentTrack?.source === "spotify" ? <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">{spotifyConnected ? "Spotify linked: the room controls your open Spotify app (Premium). Keep Spotify open on any device." : "Connect Spotify (Premium) in the queue to have the room play this on your Spotify app; otherwise press play inside the embed."}</p> : null}
            </div>

            <div className="mt-5 flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3 xl:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neon/10 text-neon"><UsersRound className="h-4 w-4" /></span>
                <div className="min-w-0"><p className="text-xs font-semibold text-foreground">Listening together</p><p className="truncate text-[11px] text-muted-foreground">{activeListeners.map((person) => person.nickname).join(", ")}</p></div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setQueueOpen(true)} className="shrink-0 border-line bg-background text-foreground hover:border-neon/50"><Music2 className="h-4 w-4" /> Queue <span className="text-neon">{queueTracks.length}</span></Button>
            </div>
          </section>

          <aside className="sticky top-[84px] hidden max-h-[calc(100svh-104px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-panel xl:flex">
            {queueContent}
          </aside>
        </div>

        {queueOpen ? (
          <div className="fixed inset-0 z-40 bg-night/70 backdrop-blur-sm xl:hidden" onClick={(event) => { if (event.target === event.currentTarget) setQueueOpen(false); }}>
            <div className="fixed inset-x-0 bottom-0 flex max-h-[82svh] flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl">
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
              {queueContent}
            </div>
          </div>
        ) : null}
        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-background/95 px-4 py-2.5 text-center text-[10px] text-muted-foreground backdrop-blur-xl xl:hidden">
          Shared queue, live with your crew <span className="px-1 text-neon">·</span> Screens on for synced listening
        </footer>
      </main>
    );
  }

  return (
    <main className="tipsy-shell min-h-[100svh] overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-[100svh] max-w-[1260px] flex-col px-5 pb-10 pt-5 sm:px-10 sm:pt-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-neon/30 bg-neon/10 text-neon"><Disc3 className="h-5 w-5" /></span>
            <span><span className="block text-base font-extrabold text-foreground">TIPSY <span className="text-neon">BAR</span></span><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">The room is the dance floor</span></span>
          </div>
          <div className="flex items-center gap-2">
              {(installPrompt || isIosDevice) && <Button type="button" variant="outline" size="sm" onClick={() => void handleInstall()} className="h-9 border-line bg-panel px-3 text-xs text-foreground hover:border-neon/50 hover:bg-panel-raised">Install</Button>}
            <span className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-[11px] font-semibold text-muted-foreground"><span className="live-dot" /> Listening rooms</span>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-12 py-9 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.85fr)] lg:gap-20 lg:py-14">
          <section className="relative mx-auto w-full max-w-[590px] lg:mx-0">
            <div className="absolute -left-10 top-6 hidden h-28 w-28 rounded-full border border-neon/10 lg:block" />
            <div className="relative grid aspect-square max-h-[440px] overflow-hidden rounded-xl border border-line bg-panel p-3 shadow-2xl sm:p-4">
              <img src={featuredCover} alt="A cocktail glowing at a night bar" width={1200} height={1200} className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] rounded-lg object-cover sm:inset-4 sm:h-[calc(100%-2rem)] sm:w-[calc(100%-2rem)]" fetchPriority="high" />
              <div className="absolute inset-x-3 bottom-3 h-1/2 rounded-b-lg bg-gradient-to-t from-night/90 to-transparent sm:inset-x-4 sm:bottom-4" />
              <div className="absolute inset-x-6 bottom-7 flex items-end justify-between gap-3 sm:bottom-8">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neon">One room, everywhere</p><p className="mt-1 text-xl font-extrabold text-foreground sm:text-2xl">Meet you at Tipsy.</p></div>
                <span className="rounded-full border border-white/15 bg-night/55 p-3 text-neon backdrop-blur"><AudioLines className="h-5 w-5" /></span>
              </div>
              <div className="absolute left-7 top-7 rounded-full border border-white/15 bg-night/55 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground backdrop-blur sm:left-8 sm:top-8"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-neon" />Sound is better together</div>
            </div>
            <div className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground sm:justify-start"><Waveform playing /><span className="ml-2">Bring your own soundtrack.</span></div>
          </section>

          <section className="mx-auto w-full max-w-[460px] lg:mx-0">
            <div className="mb-7">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neon"><span className="h-px w-6 bg-neon" /> Your friends are one link away</p>
              <h1 className="mt-4 max-w-[520px] text-4xl font-extrabold leading-[1.04] text-foreground sm:text-5xl">Same room.<br /><span className="text-neon">Different cities.</span></h1>
              <p className="mt-4 max-w-[400px] text-sm leading-6 text-muted-foreground sm:text-base">Start a room, drop in a song, and let everyone pick what plays next.</p>
            </div>

            <form onSubmit={createNewRoom} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Name your room</span>
                <input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={50} placeholder="Friday night radio" className="h-12 w-full rounded-md border border-line bg-panel px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-neon/60" />
              </label>
              <label className="block">
                <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Your nickname</span>
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={32} placeholder="The name your friends know" required className="h-12 w-full rounded-md border border-line bg-panel px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-neon/60" />
              </label>
              <Button type="submit" disabled={busy || !nickname.trim()} className="group h-12 w-full justify-between rounded-md bg-neon px-5 text-sm font-extrabold text-night hover:bg-neon/85">
                <span className="flex items-center gap-2">{busy ? <LoaderCircle className="animate-spin" /> : <Plus />} Start a new room</span><span aria-hidden="true" className="text-lg transition-transform group-hover:translate-x-1">→</span>
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground"><span className="h-px flex-1 bg-line" />Already got an invite?<span className="h-px flex-1 bg-line" /></div>

            <form onSubmit={handleJoin} className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Room code</span>
                <input value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} maxLength={8} placeholder="Enter room code" className="h-12 w-full rounded-md border border-line bg-panel px-4 font-mono text-sm uppercase tracking-[0.12em] text-foreground outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus:border-neon/60" />
              </label>
              <Button type="submit" disabled={busy || loadingRoom || !roomCodeInput.trim() || !nickname.trim()} variant="outline" className="h-12 shrink-0 border-line bg-panel px-4 font-bold text-foreground hover:border-neon/50 hover:bg-panel-raised">Join room</Button>
            </form>

            {errorMessage ? <p role="alert" className="mt-4 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5 text-xs leading-5 text-destructive">{errorMessage}</p> : null}
            {initialRoomCode && loadingRoom ? <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin text-neon" />Getting your room ready…</p> : null}

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-[11px] font-medium text-muted-foreground">
              <span className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-aqua" />No account needed</span>
              <span className="flex items-center gap-2"><Music2 className="h-4 w-4 text-neon" />YouTube + Spotify links</span>
              <span className="flex items-center gap-2"><AudioLines className="h-4 w-4 text-chart-2" />Shared live queue</span>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[10px] font-medium text-muted-foreground"><span>Made for the long way home.</span><span>One playlist, all your people.</span></footer>
      </div>
    </main>
  );
}