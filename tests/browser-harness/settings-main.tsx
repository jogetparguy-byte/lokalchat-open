import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {SettingsPage} from '../../src/routes/_authenticated/dashboard_.settings';
import '../../src/styles.css';
import {ThemeProvider} from '../../src/components/lokalchat/ThemeProvider';
const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
Object.assign(window, {settingsQueryClient: client});
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={client}><SettingsPage/></QueryClientProvider></ThemeProvider>);
