import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /admin/ (nginx routes /admin/ here and /admin/api/ to admin-api),
// so assets and API calls live under that prefix in dev and in the image alike.
export default defineConfig({
    base: '/admin/',
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/admin/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/admin\/api/, '/api'),
            },
        },
    },
});
