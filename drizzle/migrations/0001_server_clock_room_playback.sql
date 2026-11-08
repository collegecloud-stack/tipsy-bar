CREATE OR REPLACE FUNCTION public.set_room_playback_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_room_playback_updated_at
BEFORE INSERT OR UPDATE ON public.room_playback
FOR EACH ROW
EXECUTE FUNCTION public.set_room_playback_updated_at();