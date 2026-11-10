import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { finishSpotifyLogin } from "@/lib/spotify";

export const Route = createFileRoute("/auth/spotify/callback")({
  head: () => ({
    meta: [
      { title: "Connecting Spotify · Tipsy Bar" },
      { name: "description", content: "Finishing your Spotify connection for Tipsy Bar." },
      { property: "og:title", content: "Connecting Spotify · Tipsy Bar" },
      { property: "og:description", content: "Finishing your Spotify connection for Tipsy Bar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpotifyCallback,
});

function SpotifyCallback() {
  const [message, setMessage] = useState("Connecting your Spotify…");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setMessage(params.get("error") === "access_denied" ? "Spotify connection was cancelled." : "Spotify didn't send a sign-in code.");
      return;
    }
    finishSpotifyLogin(code)
      .then((back) => window.location.replace(back))
      .catch((e: Error) => setMessage(e.message));
  }, []);
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground">
      <div>
        <p className="text-sm">{message}</p>
        <a href="/" className="mt-4 inline-block text-xs text-neon underline">Back to Tipsy Bar</a>
      </div>
    </main>
  );
}
