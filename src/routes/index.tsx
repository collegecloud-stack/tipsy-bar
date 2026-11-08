import { createFileRoute } from "@tanstack/react-router";
import { TipsyApp } from "@/components/tipsy-app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tipsy Bar | Listen Together, Wherever You Are" },
      { name: "description", content: "Start a shared music room, invite your friends, and build the queue together on Tipsy Bar." },
      { property: "og:title", content: "Tipsy Bar | Listen Together, Wherever You Are" },
      { property: "og:description", content: "Your room, your soundtrack. Bring your friends and take turns in the queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return <TipsyApp />;
}