import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Remplace EXACTEMENT par le nom de ton projet GitHub entre les slashs
  base: '/Chaud-devant-Family/', 
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.VITE_API_KEY)
  }
});
