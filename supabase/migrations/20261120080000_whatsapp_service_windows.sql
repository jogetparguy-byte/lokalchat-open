CREATE TABLE public.whatsapp_service_windows (
  business_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  recipient_id text NOT NULL,
  last_customer_message_at timestamptz NOT NULL,
  PRIMARY KEY (business_id, phone_number_id, recipient_id),
  CONSTRAINT whatsapp_service_window_recipient_length CHECK (length(recipient_id) BETWEEN 1 AND 131)
);

ALTER TABLE public.whatsapp_service_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_service_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_service_windows TO service_role;

CREATE FUNCTION public.record_whatsapp_customer_event(
  p_business_id uuid,
  p_phone_number_id text,
  p_recipient_id text,
  p_provider_timestamp timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_provider_timestamp IS NULL OR p_provider_timestamp > clock_timestamp()
    OR p_provider_timestamp <= '1970-01-01'::timestamptz
    OR p_recipient_id IS NULL OR length(p_recipient_id) NOT BETWEEN 1 AND 131
    OR NOT EXISTS (
      SELECT 1 FROM public.whatsapp_connections
      WHERE business_id = p_business_id AND phone_number_id = p_phone_number_id
    ) THEN RETURN false; END IF;
  INSERT INTO public.whatsapp_service_windows (business_id, phone_number_id, recipient_id, last_customer_message_at)
  VALUES (p_business_id, p_phone_number_id, p_recipient_id, p_provider_timestamp)
  ON CONFLICT (business_id, phone_number_id, recipient_id) DO UPDATE
  SET last_customer_message_at = greatest(
    public.whatsapp_service_windows.last_customer_message_at, EXCLUDED.last_customer_message_at
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.record_whatsapp_customer_event(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_customer_event(uuid, text, text, timestamptz) TO service_role;
