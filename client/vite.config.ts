import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Old Android Chrome still has WebGL2; keep the target low enough for it.
  build: { target: 'chrome119' },
});
