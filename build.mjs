#!/usr/bin/env node
/**
 * build.mjs — injeta as variáveis do .env no userscript.
 *
 * Uso:
 *   cp .env.example .env    # preencha as chaves
 *   node build.mjs          # gera dist/tic-autopilot.user.js
 *
 * O arquivo de origem (tic-autopilot.user.js) é válido mesmo sem build,
 * mas não contém nenhuma chave: elas vêm do .env ou do painel ⚙️.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
const SRC_FILE = path.join(ROOT, 'tic-autopilot.user.js');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'tic-autopilot.user.js');

/** Lê um .env simples: KEY=VALUE, # comentários, aspas opcionais. */
function parseEnv(text) {
    const env = {};
    for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;

        let value = match[2].trim();
        const quoted =
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"));

        if (quoted) value = value.slice(1, -1);
        env[match[1]] = value;
    }
    return env;
}

/** Garante que o valor vire uma string JS segura. */
function jsString(value) {
    return JSON.stringify(String(value ?? ''));
}

async function main() {
    if (!existsSync(ENV_FILE)) {
        console.error('✖ .env não encontrado. Copie .env.example para .env e preencha as chaves.');
        process.exit(1);
    }

    const env = parseEnv(await readFile(ENV_FILE, 'utf8'));
    const source = await readFile(SRC_FILE, 'utf8');

    // Bloqueia build acidental com segredo hardcoded no fonte.
    const leak = source.match(/nvapi-[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{10,}|sk-or-[A-Za-z0-9-]{10,}/);
    if (leak) {
        console.error(`✖ Possível chave hardcoded em ${path.basename(SRC_FILE)}: ${leak[0].slice(0, 12)}...`);
        console.error('  Remova a chave do fonte e coloque-a apenas no .env.');
        process.exit(1);
    }

    const values = {
        NVIDIA_KEY: env.TIC_NVIDIA_API_KEY ?? '',
        GROQ_KEY: env.TIC_GROQ_API_KEY ?? '',
        OPENROUTER_KEY: env.TIC_OPENROUTER_API_KEY ?? '',
        MIN_SCORE: env.TIC_MIN_SCORE || '6',
        DELAY_QUIZ: env.TIC_DELAY_QUIZ || '1800',
        TIMEOUT: env.TIC_TIMEOUT || '12000',
        OPENROUTER_REFERER: env.TIC_OPENROUTER_REFERER || 'https://ticemtrilhas.instructure.com'
    };

    const block = [
        '    // <ENV>',
        '    // Bloco gerado por build.mjs a partir do .env — não edite manualmente.',
        '    const ENV = {',
        ...Object.entries(values).map(([key, value]) => `        ${key}: ${jsString(value)},`),
        '    };',
        '    // </ENV>'
    ].join('\n');

    const marker = /[ \t]*\/\/ <ENV>[\s\S]*?\/\/ <\/ENV>/;
    if (!marker.test(source)) {
        console.error('✖ Marcadores <ENV> não encontrados no userscript.');
        process.exit(1);
    }

    let output = source.replace(marker, block);
    output = output.replace(
        '// ==/UserScript==',
        [
            '// ==/UserScript==',
            '',
            `// Arquivo gerado por build.mjs em ${new Date().toISOString()}`,
            '// NÃO EDITE ESTE ARQUIVO. Edite o fonte e rode o build novamente.'
        ].join('\n')
    );

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(OUT_FILE, output, 'utf8');

    const missing = ['NVIDIA_KEY', 'GROQ_KEY', 'OPENROUTER_KEY'].filter(key => !values[key]);
    console.log(`✔ Gerado: ${path.relative(ROOT, OUT_FILE)}`);
    if (missing.length > 0) {
        console.log(`⚠ Sem chave padrão para: ${missing.join(', ')} (preencha o .env ou use o painel ⚙️).`);
    }
}

main().catch(error => {
    console.error('✖ Falha no build:', error.message);
    process.exit(1);
});
