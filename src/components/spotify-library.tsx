import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Download, LoaderCircle, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  disconnectSpotify,
  getActiveSession,
  getMyPlaylists,
  getPlaylistTracks,
  isSpotifyConnected,
  searchTracks,
  startSpotifyLogin,
  type SpotifyPlaylist,
  type SpotifyTrackItem,
} from "@/lib/spotify";

type Tab = "playlists" | "search";

export function useSpotifyConnected() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const update = () => setConnected(isSpotifyConnected());
    update();
    window.addEventListener("tipsy-spotify-change", update);
    return () => window.removeEventListener("tipsy-spotify-change", update);
  }, []);
  return connected;
}

export function SpotifyLibrary({ onAdd }: { onAdd: (tracks: SpotifyTrackItem[]) => Promise<void> }) {
  const connected = useSpotifyConnected();
  const [tab, setTab] = useState<Tab>("playlists");
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [open, setOpen] = useState<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrackItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const run = async <T,>(fn: () => Promise<T>): Promise<void> => {
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Spotify request failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connected && tab === "playlists" && playlists === null) {
      void run(async () => {
        const list = await getMyPlaylists();
        setPlaylists([{ id: "liked", name: "Liked Songs", imageUrl: null, total: 0 }, ...list]);
      });
    }
  }, [connected, tab, playlists]);

  const add = async (list: SpotifyTrackItem[]) => {
    if (!list.length) {
      toast.error("Nothing to add.");
      return;
    }
    setAdding(true);
    try {
      await onAdd(list);
    } finally {
      setAdding(false);
    }
  };

  if (!connected) {
    return (
      <div className="border-b border-line p-3 sm:p-4">
        <Button onClick={() => void startSpotifyLogin(window.location.pathname)} className="h-10 w-full bg-chart-2 font-bold text-night hover:bg-chart-2/85">
          Connect Spotify for playlists & search
        </Button>
      </div>
    );
  }

  const openPlaylist = (p: SpotifyPlaylist) => {
    setOpen(p);
    setTracks([]);
    void run(async () => setTracks(await getPlaylistTracks(p.id)));
  };

  const doSearch = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) void run(async () => setResults(await searchTracks(query.trim())));
  };

  const importSession = () => void run(async () => {
    const list = await getActiveSession();
    if (!list.length) throw new Error("Nothing is playing or queued in your Spotify app right now.");
    await add(list);
  });

  const trackRow = (t: SpotifyTrackItem) => (
    <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-raised">
      {t.artworkUrl ? <img src={t.artworkUrl} alt="" className="h-9 w-9 rounded object-cover" loading="lazy" /> : <div className="h-9 w-9 rounded bg-surface" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{t.title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{t.artist}</p>
      </div>
      <Button size="icon" variant="ghost" disabled={adding} onClick={() => void add([t])} className="h-8 w-8 text-neon" aria-label={`Add ${t.title}`}><Plus /></Button>
    </div>
  );

  return (
    <div className="border-b border-line p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-1">
        {(["playlists", "search"] as Tab[]).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)} className="h-8 text-xs capitalize">{t === "playlists" ? "My Playlists" : "Spotify Search"}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={importSession} disabled={loading || adding} className="ml-auto h-8 gap-1 text-xs" title="Import what's playing and queued in your Spotify app"><Download className="h-3.5 w-3.5" />Import session</Button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {tab === "search" ? (
          <>
            <form onSubmit={doSearch} className="mb-2 flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Songs, artists, albums" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-background px-3 text-sm text-foreground outline-none focus:border-neon/60" />
              <Button type="submit" size="icon" className="h-9 w-9" aria-label="Search Spotify"><Search /></Button>
            </form>
            {results.map(trackRow)}
          </>
        ) : open ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={() => setOpen(null)} className="h-8 w-8" aria-label="Back to playlists"><ArrowLeft /></Button>
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{open.name}</p>
              <Button size="sm" disabled={adding || loading || !tracks.length} onClick={() => void add(tracks)} className="h-8 bg-neon text-xs font-bold text-night hover:bg-neon/85">
                {adding ? <LoaderCircle className="animate-spin" /> : null} Queue all {tracks.length || ""}
              </Button>
            </div>
            {tracks.map(trackRow)}
          </>
        ) : (
          (playlists ?? []).map((p) => (
            <button key={p.id} onClick={() => openPlaylist(p)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-raised">
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-9 w-9 rounded object-cover" loading="lazy" /> : <div className="grid h-9 w-9 place-items-center rounded bg-neon/15 text-neon">♥</div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{p.name}</p>
                {p.total ? <p className="text-[11px] text-muted-foreground">{p.total} songs</p> : null}
              </div>
            </button>
          ))
        )}
        {loading ? <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading…</p> : null}
      </div>
      <button onClick={disconnectSpotify} className="mt-2 text-[10px] text-muted-foreground underline">Disconnect Spotify</button>
    </div>
  );
}
