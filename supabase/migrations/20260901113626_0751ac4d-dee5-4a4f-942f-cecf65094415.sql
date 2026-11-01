CREATE POLICY "Businesses read own kb files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kb-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Businesses upload own kb files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kb-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Businesses update own kb files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'kb-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'kb-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Businesses delete own kb files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'kb-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
