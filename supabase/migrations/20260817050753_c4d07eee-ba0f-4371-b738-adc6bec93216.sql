-- Drop any existing single-column unique constraint or index on customer_phone.
-- The exact name may vary depending on how it was created, so we look it up
-- from the catalog rather than hard-coding one name.
DO $$
DECLARE
  constraint_rec record;
  index_rec record;
BEGIN
  -- Drop unique constraints that cover ONLY the customer_phone column.
  FOR constraint_rec IN
    SELECT con.conname AS name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE cls.relname = 'chats'
      AND ns.nspname = 'public'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND a.attname = 'customer_phone'
  LOOP
    EXECUTE format('ALTER TABLE public.chats DROP CONSTRAINT %I', constraint_rec.name);
  END LOOP;

  -- Drop unique indexes that cover ONLY the customer_phone column.
  FOR index_rec IN
    SELECT i.indexrelid::regclass::text AS name
    FROM pg_index i
    JOIN pg_class cls ON cls.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE cls.relname = 'chats'
      AND ns.nspname = 'public'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'customer_phone'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', index_rec.name);
  END LOOP;
END $$;

-- Enforce uniqueness per business, not globally.
-- Existing rows with NULL business_id are allowed temporarily until backfilled.
ALTER TABLE public.chats
  ADD CONSTRAINT chats_business_customer_phone_unique UNIQUE (business_id, customer_phone);
