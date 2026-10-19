import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  optimizeDeps: {
    exclude: ['@inkeep/mermaid-wysiwyg-core', '@inkeep/mermaid-wysiwyg-dom', '@inkeep/mermaid-wysiwyg-codemirror', '@inkeep/mermaid-wysiwyg-react'],
    include: ['mermaid', 'react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
