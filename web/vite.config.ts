import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Versão do app: vem de versoes.json (a primeira entrada é a atual).
 * Cada build ganha também um "build" único; o app compara com dist/version.json (sem cache)
 * para saber se há versão nova publicada e mostrar o botão Atualizar.
 */
const versoes = JSON.parse(readFileSync(new URL('./versoes.json', import.meta.url), 'utf8')) as { versao: string; data: string; novidades: string[] }[];
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const info = { versao: versoes[0]!.versao, data: versoes[0]!.data, build };

function versaoPlugin(): Plugin {
  return {
    name: 'fabrica-versao',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...info, novidades: versoes[0]!.novidades }) });
    },
  };
}

// base './' permite publicar em qualquer subpasta (GitHub Pages, Vercel, Netlify, pasta no servidor).
export default defineConfig({
  base: './',
  plugins: [react(), versaoPlugin()],
  define: { __VERSAO__: JSON.stringify(info), __VERSOES__: JSON.stringify(versoes) },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
