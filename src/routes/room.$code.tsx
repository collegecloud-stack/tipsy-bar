import { createFileRoute } from "@tanstack/react-router";
import { TipsyApp } from "@/components/tipsy-app";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Join room ${params.code.toUpperCase()} | Tipsy Bar` },
      { name: "description", content: "Join your friends' listening room on Tipsy Bar with a nickname and pick the next song together." },
      { property: "og:title", content: `Join room ${params.code.toUpperCase()} | Tipsy Bar` },
      { property: "og:description", content: "Join your friends, share music, and build the queue together in a Tipsy Bar room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  return <TipsyApp initialRoomCode={code} />;
}