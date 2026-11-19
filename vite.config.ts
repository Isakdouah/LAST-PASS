import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file in dist/, so a build can be shared as a single private link.
export default defineConfig({
  plugins: [viteSingleFile()],
});
