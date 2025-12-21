import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Cela permet au code de lire la clé API sur GitHub et en local
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  },
  base: './', 
});
