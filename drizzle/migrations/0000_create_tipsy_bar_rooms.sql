CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  name text NOT NULL,
  host_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guests can access shared rooms" ON public.rooms FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Signed-in visitors can access shared rooms" ON public.rooms FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL,
  nickname text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, visitor_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_members TO anon, authenticated;
GRANT ALL ON public.room_members TO service_role;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guests can access room listeners" ON public.room_members FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Signed-in visitors can access room listeners" ON public.room_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX room_members_room_id_idx ON public.room_members(room_id);

CREATE TABLE public.room_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.room_members(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('youtube', 'spotify')),
  source_id text NOT NULL,
  track_url text NOT NULL,
  title text NOT NULL,
  artist text NOT NULL DEFAULT 'Unknown artist',
  artwork_url text,
  duration_seconds integer,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_tracks TO anon, authenticated;
GRANT ALL ON public.room_tracks TO service_role;
ALTER TABLE public.room_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guests can access the shared queue" ON public.room_tracks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Signed-in visitors can access the shared queue" ON public.room_tracks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX room_tracks_room_position_idx ON public.room_tracks(room_id, position, added_at);

CREATE TABLE public.track_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.room_tracks(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_id, voter_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.track_votes TO anon, authenticated;
GRANT ALL ON public.track_votes TO service_role;
ALTER TABLE public.track_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guests can access queue votes" ON public.track_votes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Signed-in visitors can access queue votes" ON public.track_votes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX track_votes_room_track_idx ON public.track_votes(room_id, track_id);

CREATE TABLE public.room_playback (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  track_id uuid REFERENCES public.room_tracks(id) ON DELETE SET NULL,
  is_playing boolean NOT NULL DEFAULT false,
  position_seconds double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_playback TO anon, authenticated;
GRANT ALL ON public.room_playback TO service_role;
ALTER TABLE public.room_playback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Guests can access shared playback" ON public.room_playback FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Signed-in visitors can access shared playback" ON public.room_playback FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.rooms ADD CONSTRAINT rooms_host_member_fk FOREIGN KEY (host_member_id) REFERENCES public.room_members(id) ON DELETE SET NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_tracks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.track_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_playback;