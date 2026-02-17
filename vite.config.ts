import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // ⚠️ TRÈS IMPORTANT : Remplace par le nom EXACT de ton dépôt GitHub entre les slashs
  base: '/Chaud-devant-Family/', 
})
