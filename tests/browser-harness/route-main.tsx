import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {DashboardPage} from '../../src/routes/_authenticated/dashboard_.inbox';
import '../../src/styles.css';
const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
Object.assign(window, {routeQueryClient: client});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><DashboardPage/></QueryClientProvider>);
