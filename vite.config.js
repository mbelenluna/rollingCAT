import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // GitHub Pages project sites need the repository path as the base URL.
  const base = env.VITE_BASE_PATH || (mode === 'production' ? '/rollingCAT/' : '/');

  return {
    base,
    plugins: [react()],
  };
});
