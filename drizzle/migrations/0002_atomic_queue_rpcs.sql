CREATE OR REPLACE FUNCTION public.add_room_track(
  p_room_id uuid, p_added_by uuid, p_source text, p_source_id text, p_track_url text,
  p_title text, p_artist text, p_artwork_url text
) RETURNS public.room_tracks
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_row public.room_tracks;
BEGIN
  -- Serialize inserts per room so concurrent adds never share a position.
  PERFORM pg_advisory_xact_lock(hashtext('room_tracks:' || p_room_id::text));
  INSERT INTO public.room_tracks (room_id, added_by, source, source_id, track_url, title, artist, artwork_url, position)
  VALUES (p_room_id, p_added_by, p_source, p_source_id, p_track_url, p_title, COALESCE(p_artist, 'Unknown artist'), p_artwork_url,
    (SELECT COALESCE(MAX(position), 0) + 1 FROM public.room_tracks WHERE room_id = p_room_id))
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_room_track_positions(
  p_room_id uuid, p_track_ids uuid[], p_start_position integer
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('room_tracks:' || p_room_id::text));
  UPDATE public.room_tracks t
  SET position = p_start_position + o.ord - 1
  FROM unnest(p_track_ids) WITH ORDINALITY AS o(id, ord)
  WHERE t.id = o.id AND t.room_id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_room_track(uuid, uuid, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_track_positions(uuid, uuid[], integer) TO anon, authenticated;