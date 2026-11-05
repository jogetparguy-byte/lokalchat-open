import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react(),tailwind()],resolve:{alias:{'@/integrations/supabase/client':fileURLToPath(new URL('./settings-auth.ts',import.meta.url)),'@/services/api':fileURLToPath(new URL('./route-api.ts',import.meta.url)),'@/components/lokalchat/ConsoleShell':fileURLToPath(new URL('./route-shell.tsx',import.meta.url)),'@tanstack/react-router':fileURLToPath(new URL('./route-router.ts',import.meta.url)),'@':fileURLToPath(new URL('../../src',import.meta.url))}},server:{host:'127.0.0.1',port:5175,strictPort:true,fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}}});
