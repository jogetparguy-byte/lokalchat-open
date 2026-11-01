-- Add business_id tenant column to chats
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.chats.business_id IS 'Tenant scoping: references profiles(id). Nullable only while existing rows are being backfilled; should be made NOT NULL afterwards.';

CREATE INDEX IF NOT EXISTS idx_chats_business_id ON public.chats(business_id);

-- Add business_id tenant column to knowledge_base
ALTER TABLE public.knowledge_base
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.knowledge_base.business_id IS 'Tenant scoping: references profiles(id). Nullable only while existing rows are being backfilled; should be made NOT NULL afterwards.';

CREATE INDEX IF NOT EXISTS idx_knowledge_base_business_id ON public.knowledge_base(business_id);
