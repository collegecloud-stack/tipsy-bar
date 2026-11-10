// Spotify Web API via Authorization Code + PKCE (browser-only, no client secret).
// The Client ID is public by design; tokens live only in this browser's localStorage.
export const SPOTIFY_CLIENT_ID = "ea68209e699647219edff6a4b4363e98";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
].join(" ");
const TOKEN_KEY = "tipsy-spotify-token";
const VERIFIER_KEY = "tipsy-spotify-verifier";
const RETURN_KEY = "tipsy-spotify-return";

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SpotifyTrackItem {
  id: string;
  uri: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  url: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
  total: number;
}

export function getRedirectUri() {
  return `${window.location.origin}/auth/spotify/callback`;
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startSpotifyLogin(returnPath: string) {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(RETURN_KEY, returnPath);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  }).toString();
  window.location.assign(url.toString());
}

function saveToken(json: { access_token: string; refresh_token?: string; expires_in: number }, previousRefresh?: string) {
  const token: StoredToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? previousRefresh ?? "",
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  window.dispatchEvent(new Event("tipsy-spotify-change"));
}

export async function finishSpotifyLogin(code: string): Promise<string> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error("Spotify sign-in expired. Please try connecting again.");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("Spotify didn't accept the sign-in. Please try again.");
  saveToken(await res.json());
  localStorage.removeItem(VERIFIER_KEY);
  const back = localStorage.getItem(RETURN_KEY) || "/";
  localStorage.removeItem(RETURN_KEY);
  return back;
}

export function isSpotifyConnected() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export function disconnectSpotify() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("tipsy-spotify-change"));
}

async function getAccessToken(): Promise<string> {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) throw new Error("Connect Spotify first.");
  const token = JSON.parse(raw) as StoredToken;
  if (Date.now() < token.expires_at) return token.access_token;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, grant_type: "refresh_token", refresh_token: token.refresh_token }),
  });
  if (!res.ok) {
    disconnectSpotify();
    throw new Error("Your Spotify session ended. Tap Connect Spotify again.");
  }
  const json = await res.json();
  saveToken(json, token.refresh_token);
  return json.access_token as string;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await getAccessToken();
  const res = await fetch(path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return null;
  if (res.status === 404 && path.startsWith("/me/player")) throw new Error("No active Spotify device. Open Spotify on your phone or computer and play anything once.");
  if (res.status === 403 && path.startsWith("/me/player")) throw new Error("Spotify remote control needs a Premium account.");
  if (!res.ok) throw new Error(`Spotify request failed (${res.status}).`);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTrack(t: any): SpotifyTrackItem | null {
  if (!t || t.type !== "track" || !t.id) return null;
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: (t.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    artworkUrl: t.album?.images?.[0]?.url ?? null,
    url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
  };
}

const notNull = <T,>(v: T | null): v is T => v !== null;

export async function getMyPlaylists(): Promise<SpotifyPlaylist[]> {
  const out: SpotifyPlaylist[] = [];
  let next: string | null = "/me/playlists?limit=50";
  while (next && out.length < 200) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await api(next);
    for (const p of page?.items ?? []) {
      if (p) out.push({ id: p.id, name: p.name, imageUrl: p.images?.[0]?.url ?? null, total: p.tracks?.total ?? p.items?.total ?? 0 });
    }
    next = page?.next ?? null;
  }
  return out;
}

export async function getPlaylistTracks(playlistId: string): Promise<SpotifyTrackItem[]> {
  const out: SpotifyTrackItem[] = [];
  let next: string | null = playlistId === "liked" ? "/me/tracks?limit=50" : `/playlists/${playlistId}/tracks?limit=100`;
  while (next && out.length < 500) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page: any = await api(next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.push(...(page?.items ?? []).map((i: any) => toTrack(i.track ?? i.item)).filter(notNull));
    next = page?.next ?? null;
  }
  return out;
}

export async function searchTracks(query: string): Promise<SpotifyTrackItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await api(`/search?type=track&limit=20&q=${encodeURIComponent(query)}`);
  return (res?.tracks?.items ?? []).map(toTrack).filter(notNull);
}

export async function getActiveSession(): Promise<SpotifyTrackItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await api("/me/player/queue");
  const list = [toTrack(res?.currently_playing), ...(res?.queue ?? []).map(toTrack)].filter(notNull);
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export async function remotePlay(trackId: string, positionMs: number) {
  await api("/me/player/play", { method: "PUT", body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: Math.max(0, Math.round(positionMs)) }) });
}

export async function remotePause() {
  try {
    await api("/me/player/pause", { method: "PUT" });
  } catch {
    // Already paused or no device: nothing to do.
  }
}
