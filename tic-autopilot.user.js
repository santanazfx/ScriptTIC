// ==UserScript==
// @name         TIC em Trilhas - Autopilot v17.0 (Robust Parser & Auto-Recovery)
// @namespace    http://tampermonkey.net/
// @version      17.0
// @description  Resolve travamentos pós-IA com parser flexível, tratamento de nulos e auto-recuperação.
// @match        https://ticemtrilhas.instructure.com/courses/*
// @grant        none
// ==/UserScript==

(async function() {
    'use strict';

    window.confirm = () => true;
    window.alert = () => true;
    window.prompt = () => null;

    // <ENV>
    // Bloco gerado por build.mjs a partir do .env.
    // Os valores abaixo são apenas padrões seguros para o arquivo-fonte.
    // Nunca coloque chaves reais neste arquivo.
    const ENV = {
        NVIDIA_KEY: '',
        GROQ_KEY: '',
        OPENROUTER_KEY: '',
        MIN_SCORE: '6',
        DELAY_QUIZ: '1800',
        TIMEOUT: '12000',
        OPENROUTER_REFERER: 'https://ticemtrilhas.instructure.com'
    };
    // </ENV>

    const courseMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    if (!courseMatch) return;
    const COURSE_ID = courseMatch[1];

    const CONFIG = {
        COURSE_ID: COURSE_ID,
        MIN_SCORE: Number(ENV.MIN_SCORE) || 6,
        DELAY_QUIZ: Number(ENV.DELAY_QUIZ) || 1800,
        TIMEOUT: Number(ENV.TIMEOUT) || 12000,
        NVIDIA_KEY: 'tic_nvidia_key',
        GROQ_KEY: 'tic_groq_key',
        OPENROUTER_KEY: 'tic_openrouter_key',
        FASTEST_AI_KEY: 'tic_fastest_ai',
        AUTOPILOT_KEY: 'tic_autopilot_status',
        OPENROUTER_REFERER: ENV.OPENROUTER_REFERER || 'https://ticemtrilhas.instructure.com',
        
        NVIDIA_MODELS: [
            'meta/llama-3.3-70b-instruct',
            'nvidia/llama-3.1-nemotron-70b-instruct',
            'meta/llama3-70b-instruct',
            'mistralai/mistral-large-2-instruct'
        ],
        GROQ_MODELS: [
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
            'llama3-70b-8192',
            'mixtral-8x7b-32768'
        ],
        OPENROUTER_MODELS: [
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemini-2.0-flash-lite-001:free',
            'deepseek/deepseek-r1:free',
            'openrouter/free'
        ]
    };

    // Chaves vindas do .env viram padrão no localStorage.
    // Qualquer chave salva manualmente pelo painel tem prioridade sobre o .env.
    const seedEnvKey = (storageKey, value) => {
        if (value && !localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, value);
        }
    };
    seedEnvKey(CONFIG.NVIDIA_KEY, ENV.NVIDIA_KEY);
    seedEnvKey(CONFIG.GROQ_KEY, ENV.GROQ_KEY);
    seedEnvKey(CONFIG.OPENROUTER_KEY, ENV.OPENROUTER_KEY);

    let isRunning = localStorage.getItem(CONFIG.AUTOPILOT_KEY) === 'on';
    const QUEUE_KEY = `tic_target_queue_${COURSE_ID}`;
    const SKIPPED_KEY = 'tic_skipped_quizzes';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = sel => document.querySelector(sel);
    const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content;

    const getQueue = () => JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]');
    const saveQueue = q => sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    const clearQueue = () => sessionStorage.removeItem(QUEUE_KEY);

    const getSkipped = () => JSON.parse(sessionStorage.getItem(SKIPPED_KEY) || '[]');
    const markSkipped = id => {
        if (!id) return;
        const s = getSkipped();
        const strId = String(id);
        if (!s.includes(strId)) { 
            s.push(strId); 
            sessionStorage.setItem(SKIPPED_KEY, JSON.stringify(s)); 
        }
    };
    const isSkipped = id => getSkipped().includes(String(id));

    function createUI() {
        if ($('#tic-autopilot')) return;
        const p = document.createElement('div');
        p.id = 'tic-autopilot';
        p.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;background:#1a202c;color:#fff;padding:14px;border-radius:10px;font-family:system-ui;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5);width:340px;`;

        p.innerHTML = `
            <div style="font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <span>🎓 Autopilot v17.0 (Auto-Recovery)</span>
                <div style="display:flex; gap:5px;">
                    <span id="tic-state" style="font-size:10px;opacity:.7;margin-top:2px;">idle</span>
                    <button id="tic-gear" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0;">⚙️</button>
                </div>
            </div>
            <div id="tic-msg" style="font-size:11px;opacity:.8;margin-bottom:10px;min-height:30px;line-height:1.4;">Curso: ${COURSE_ID}</div>

            <div id="tic-key-setup" style="display:none; margin-bottom:10px; padding:10px; background:#2d3748; border-radius:6px;">
                <div style="font-size:11px; margin-bottom:4px; font-weight:bold; color:#68d391;">Chave NVIDIA (nvapi-...)</div>
                <input type="text" id="tic-nv-input" placeholder="nvapi-..." value="${localStorage.getItem(CONFIG.NVIDIA_KEY)||''}" style="width:100%;padding:4px;margin-bottom:6px;border-radius:4px;border:none;font-size:11px;">
                
                <div style="font-size:11px; margin-bottom:4px; font-weight:bold; color:#f6ad55;">Chave Groq (gsk_...)</div>
                <input type="text" id="tic-groq-input" placeholder="gsk_..." value="${localStorage.getItem(CONFIG.GROQ_KEY)||''}" style="width:100%;padding:4px;margin-bottom:6px;border-radius:4px;border:none;font-size:11px;">
                
                <div style="font-size:11px; margin-bottom:4px; font-weight:bold; color:#63b3ed;">Chave OpenRouter (sk-or-...)</div>
                <input type="text" id="tic-or-input" placeholder="sk-or-..." value="${localStorage.getItem(CONFIG.OPENROUTER_KEY)||''}" style="width:100%;padding:4px;margin-bottom:6px;border-radius:4px;border:none;font-size:11px;">
                
                <button id="tic-key-save" style="width:100%;padding:6px;background:#3182ce;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">Salvar Chaves</button>
            </div>

            <button id="tic-toggle" style="width:100%;padding:9px;background:${isRunning?'#ed8936':'#48bb78'};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;margin-bottom:6px;">
                ${isRunning ? '⏸ Pausar' : '▶ Iniciar Autopilot (v17.0)'}
            </button>
            <button id="tic-skip" style="width:100%;padding:9px;background:#e53e3e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">⏭ Pular este Item (Manual)</button>
        `;
        document.body.appendChild(p);

        p.querySelector('#tic-gear').onclick = () => {
            const setup = p.querySelector('#tic-key-setup');
            setup.style.display = setup.style.display === 'none' ? 'block' : 'none';
        };

        p.querySelector('#tic-key-save').onclick = () => {
            const nvVal = p.querySelector('#tic-nv-input').value.trim();
            const gVal = p.querySelector('#tic-groq-input').value.trim();
            const oVal = p.querySelector('#tic-or-input').value.trim();
            
            if (nvVal) localStorage.setItem(CONFIG.NVIDIA_KEY, nvVal); else localStorage.removeItem(CONFIG.NVIDIA_KEY);
            if (gVal) localStorage.setItem(CONFIG.GROQ_KEY, gVal); else localStorage.removeItem(CONFIG.GROQ_KEY);
            if (oVal) localStorage.setItem(CONFIG.OPENROUTER_KEY, oVal); else localStorage.removeItem(CONFIG.OPENROUTER_KEY);
            
            localStorage.removeItem(CONFIG.FASTEST_AI_KEY);

            setStatus('working', 'Chaves salvas! Corrida resetada.');
            p.querySelector('#tic-key-setup').style.display = 'none';
        };

        p.querySelector('#tic-toggle').onclick = () => {
            const nvidia = localStorage.getItem(CONFIG.NVIDIA_KEY);
            const groq = localStorage.getItem(CONFIG.GROQ_KEY);
            const openRouter = localStorage.getItem(CONFIG.OPENROUTER_KEY);

            if (!nvidia && !groq && !openRouter) {
                p.querySelector('#tic-key-setup').style.display = 'block';
                setStatus('error', 'Insira pelo menos 1 chave de IA.');
                return;
            }

            isRunning = !isRunning;
            localStorage.setItem(CONFIG.AUTOPILOT_KEY, isRunning ? 'on' : 'off');
            p.querySelector('#tic-toggle').textContent = isRunning ? '⏸ Pausar' : '▶ Iniciar Autopilot (v17.0)';
            p.querySelector('#tic-toggle').style.background = isRunning ? '#ed8936' : '#48bb78';
            if (isRunning) {
                clearQueue();
                boot();
            } else {
                stopAutopilot();
            }
        };

        p.querySelector('#tic-skip').onclick = () => {
            const path = window.location.pathname;
            const quizId = path.match(/\/quizzes\/(\d+)/)?.[1];
            const assignId = path.match(/\/assignments\/(\d+)/)?.[1];
            if (quizId) markSkipped(quizId);
            if (assignId) markSkipped(assignId);
            jumpToNextTarget();
        };
    }

    function setStatus(state, msg) {
        const el = $('#tic-state'), msgEl = $('#tic-msg');
        if (!el) return;
        const colors = { idle: '#a0aec0', working: '#f6ad55', error: '#fc8181', done: '#68d391' };
        el.textContent = state;
        el.style.color = colors[state] || '#fff';
        msgEl.textContent = msg;
    }

    function stopAutopilot() {
        isRunning = false;
        localStorage.setItem(CONFIG.AUTOPILOT_KEY, 'off');
        clearQueue();
        if ($('#tic-toggle')) {
            $('#tic-toggle').textContent = '▶ Iniciar Autopilot (v17.0)';
            $('#tic-toggle').style.background = '#48bb78';
        }
    }

    function isCertificateScreen() {
        const mainContent = document.querySelector('#content, #main, .show-content');
        if (!mainContent) return false;

        const clone = mainContent.cloneNode(true);
        clone.querySelectorAll('#left-side, #breadcrumbs, nav, .ic-app-header, .module-sequence-footer').forEach(el => el.remove());

        const text = clone.innerText || '';
        const hasCertDownload = /baixar\s+seu\s+certificado|download\s+do\s+certificado|emitir\s+seu\s+certificado|parabéns.*trilha\s+concluída|certificado\s+disponível/i.test(text);

        const hasDownloadBtn = Array.from(clone.querySelectorAll('a, button, input[type="button"]')).some(el => {
            const label = (el.innerText || el.value || '').toLowerCase();
            const href = (el.href || '').toLowerCase();
            return (label.includes('baixar') || label.includes('download') || label.includes('emitir')) && 
                   (label.includes('certificado') || href.includes('certificate'));
        });

        return hasCertDownload || hasDownloadBtn;
    }

    function clickNextButton() {
        const nextBtn = document.querySelector('#sequence_footer a.next') ||
                        document.querySelector('.module-sequence-footer a.next') ||
                        document.querySelector('.sequence-footer-button-right a') ||
                        Array.from(document.querySelectorAll('a, button')).find(el => /^próximo$|^avançar$|^seguinte$/i.test((el.innerText || '').trim()));
        if (nextBtn) {
            setStatus('working', '➡️ Clicando em Próximo para avançar...');
            nextBtn.click();
            return true;
        }
        return false;
    }

    async function apiGet(url) {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
        return r.json();
    }

    async function markPageAsDoneViaAPI(moduleId, itemId) {
        try {
            const res = await fetch(`/api/v1/courses/${CONFIG.COURSE_ID}/modules/${moduleId}/items/${itemId}/done`, {
                method: 'PUT',
                headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrf() },
                credentials: 'same-origin'
            });
            return res.ok || res.status === 422;
        } catch (e) { return false; }
    }

    async function buildTargetQueue() {
        setStatus('working', '⚡ Mapeando estrutura...');
        const queue = [];

        try {
            const modules = await apiGet(`/api/v1/courses/${CONFIG.COURSE_ID}/modules?include[]=items&per_page=100`);

            for (const m of modules) {
                if (m.state === 'completed' || m.completed === true) continue;

                let items = [];
                try {
                    items = await apiGet(`/api/v1/courses/${CONFIG.COURSE_ID}/modules/${m.id}/items?per_page=500`);
                } catch (err) { continue; }

                for (const it of items) {
                    if (it.type === 'SubHeader') continue;
                    if (it.completion_requirement?.completed === true) continue;

                    const itemContentId = String(it.content_id || it.id);

                    if (it.type === 'Quiz' || it.type === 'Assignment') {
                        if (!isSkipped(itemContentId)) {
                            const url = it.type === 'Quiz' 
                                ? `/courses/${CONFIG.COURSE_ID}/quizzes/${it.content_id}`
                                : `/courses/${CONFIG.COURSE_ID}/assignments/${it.content_id}`;
                            queue.push({ id: itemContentId, url: url, title: it.title, type: it.type });
                        }
                    } else if (it.type === 'Page') {
                        await markPageAsDoneViaAPI(m.id, it.id);
                    }
                }
            }

            saveQueue(queue);
            return queue;
        } catch (e) {
            setStatus('error', `Erro na API: ${e.message}`);
            return [];
        }
    }

    async function jumpToNextTarget() {
        if (!isRunning) return;

        if (isCertificateScreen()) {
            setStatus('done', '🎓 Tela de Certificado alcançada! Download pronto.');
            stopAutopilot();
            return;
        }

        let queue = getQueue();
        if (queue.length === 0) {
            queue = await buildTargetQueue();
        }

        queue = queue.filter(item => !isSkipped(item.id));
        saveQueue(queue);

        if (queue.length > 0) {
            const nextItem = queue.shift();
            saveQueue(queue);

            setStatus('working', `🚀 Indo para: ${nextItem.title}`);
            await sleep(500);
            window.location.href = nextItem.url;
        } else {
            if (!clickNextButton()) {
                setStatus('done', '🎉 Fila e módulos finalizados!');
                stopAutopilot();
            }
        }
    }

    async function waitForQuizContainer() {
        for (let i = 0; i < 10; i++) {
            const container = document.querySelector('#questions, #submit_quiz_form, .display_question');
            if (container) return true;
            await sleep(300);
        }
        return false;
    }

    function extractQuestionsFromDOM() {
        const qs = [];
        const container = document.querySelector('#questions, #submit_quiz_form') || document;
        
        container.querySelectorAll('.display_question, .question').forEach(q => {
            const qText = q.querySelector('.question_text')?.innerText.trim() || q.innerText.trim() || '';

            const radios = q.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) {
                const qName = radios[0].name;
                const options = [];
                radios.forEach(r => {
                    const labelEl = r.closest('.answer_row') || r.closest('label');
                    options.push({ id: r.value, text: labelEl ? labelEl.innerText.trim() : '' });
                });
                qs.push({ type: 'radio', name: qName, text: qText, options: options });
                return;
            }

            const checkboxes = q.querySelectorAll('input[type="checkbox"]');
            if (checkboxes.length > 0) {
                const qName = checkboxes[0].name;
                const options = [];
                checkboxes.forEach(c => {
                    const labelEl = c.closest('.answer_row') || c.closest('label');
                    options.push({ id: c.value, text: labelEl ? labelEl.innerText.trim() : '' });
                });
                qs.push({ type: 'checkbox', name: qName, text: `${qText} (SELEÇÃO MÚLTIPLA)`, options: options });
                return;
            }

            const selects = q.querySelectorAll('select');
            if (selects.length > 0) {
                const textClone = q.querySelector('.question_text')?.cloneNode(true) || q.cloneNode(true);
                textClone.querySelectorAll('select').forEach(s => {
                    const fieldName = s.name || s.id;
                    const placeholder = document.createTextNode(` ___ [CAMPO: ${fieldName}] ___ `);
                    s.parentNode.replaceChild(placeholder, s);
                });

                const fullContextText = textClone.innerText.replace(/\s+/g, ' ').trim();

                selects.forEach((sel) => {
                    const fieldName = sel.name || sel.id;
                    const options = [];
                    sel.querySelectorAll('option').forEach(opt => {
                        const val = opt.value;
                        const txt = opt.innerText.trim();
                        if (val && val !== '' && !opt.disabled && txt !== '[ Selecionar ]' && txt !== 'Selecionar') {
                            options.push({ id: val, text: txt });
                        }
                    });

                    qs.push({
                        type: 'select',
                        name: fieldName,
                        text: `LACUNA [${fieldName}]: "${fullContextText}"`,
                        options: options
                    });
                });
                return;
            }

            const textarea = q.querySelector('textarea');
            if (textarea) {
                qs.push({ type: 'text', name: textarea.name || textarea.id, text: qText });
            }
        });
        return qs;
    }

    // PARSER ROBUSTO DE RESPOSTAS COM MATCH FLEXÍVEL DE CHAVES
    function parseIAAnswer(rawText, questions) {
        if (!rawText || typeof rawText !== 'string') return {};
        
        let cleanText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        let parsed = {};
        try {
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleanText = jsonMatch[0];
            parsed = JSON.parse(cleanText);
        } catch (e) { parsed = {}; }

        const finalAnswers = {};
        questions.forEach(q => {
            let foundValue = null;
            
            // Busca exata ou por correspondência aproximada de chaves
            let target = parsed[q.name];
            if (target === undefined) {
                const foundKey = Object.keys(parsed).find(k => 
                    k.toLowerCase() === q.name.toLowerCase() || 
                    q.name.toLowerCase().includes(k.toLowerCase()) || 
                    k.toLowerCase().includes(q.name.toLowerCase())
                );
                if (foundKey) target = parsed[foundKey];
            }

            if (target !== undefined && target !== null) {
                if (Array.isArray(target)) {
                    foundValue = target.map(t => String(t).trim());
                } else {
                    const targetStr = String(target).trim().toLowerCase();
                    if (q.options) {
                        const matchById = q.options.find(o => String(o.id).trim().toLowerCase() === targetStr);
                        const matchByText = q.options.find(o => o.text.trim().toLowerCase() === targetStr || o.text.trim().toLowerCase().includes(targetStr));
                        
                        if (matchById) foundValue = matchById.id;
                        else if (matchByText) foundValue = matchByText.id;
                        else foundValue = String(target);
                    } else {
                        foundValue = String(target);
                    }
                }
            }

            if (foundValue) finalAnswers[q.name] = foundValue;
        });
        return finalAnswers;
    }

    function injectText(element, text) {
        try {
            element.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            if (nativeSetter) nativeSetter.call(element, text);
            else element.value = text;

            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        } catch (e) { return false; }
    }

    function buildUserPrompt(questions) {
        let userPrompt = `Responda as questões. Retorne APENAS um JSON no formato {"nome_do_campo": "ID_da_opcao"}.\n\n`;
        questions.forEach(q => {
            userPrompt += `=== CAMPO: ${q.name} ===\nCONTEXTO: ${q.text}\nOPÇÕES DISPONÍVEIS:\n`;
            if (q.options) {
                q.options.forEach(o => userPrompt += `  - ID="${o.id}": "${o.text}"\n`);
            } else {
                userPrompt += `  - (Escreva uma resposta curta)\n`;
            }
            userPrompt += `\n`;
        });
        return userPrompt;
    }

    async function askNvidia(questions, apiKey) {
        const userPrompt = buildUserPrompt(questions);
        let lastError = null;

        for (const modelName of CONFIG.NVIDIA_MODELS) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

            try {
                const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            { role: 'system', content: 'Responda apenas com JSON puro.' },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 1024
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const content = data?.choices?.[0]?.message?.content || '';
                    if (!content) throw new Error('NVIDIA: Resposta vazia.');
                    return parseIAAnswer(content, questions);
                } else {
                    lastError = new Error(`NVIDIA HTTP ${res.status}`);
                }
            } catch (e) {
                clearTimeout(timeoutId);
                lastError = e;
            }
        }
        throw lastError || new Error('NVIDIA: Todos os modelos falharam.');
    }

    async function askGroq(questions, apiKey) {
        const userPrompt = buildUserPrompt(questions);
        let lastError = null;

        for (const modelName of CONFIG.GROQ_MODELS) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [{ role: 'system', content: 'Responda apenas com JSON puro.' }, { role: 'user', content: userPrompt }],
                        temperature: 0.0,
                        response_format: { type: "json_object" }
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const content = data?.choices?.[0]?.message?.content || '';
                    if (!content) throw new Error('Groq: Resposta vazia.');
                    return parseIAAnswer(content, questions);
                } else {
                    lastError = new Error(`Groq HTTP ${res.status}`);
                }
            } catch (e) {
                clearTimeout(timeoutId);
                lastError = e;
            }
        }
        throw lastError || new Error('Groq: Todos os modelos falharam.');
    }

    async function askOpenRouter(questions, apiKey) {
        const userPrompt = buildUserPrompt(questions);
        let lastError = null;

        for (const modelName of CONFIG.OPENROUTER_MODELS) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': CONFIG.OPENROUTER_REFERER },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [{ role: 'system', content: 'Responda apenas com JSON puro.' }, { role: 'user', content: userPrompt }],
                        temperature: 0.0
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const content = data?.choices?.[0]?.message?.content || '';
                    if (!content) throw new Error('OpenRouter: Resposta vazia.');
                    return parseIAAnswer(content, questions);
                } else {
                    lastError = new Error(`OpenRouter HTTP ${res.status}`);
                }
            } catch (e) {
                clearTimeout(timeoutId);
                lastError = e;
            }
        }
        throw lastError || new Error('OpenRouter: Todos os modelos falharam.');
    }

    async function askIA(questions) {
        const keys = {
            nvidia: localStorage.getItem(CONFIG.NVIDIA_KEY),
            groq: localStorage.getItem(CONFIG.GROQ_KEY),
            openrouter: localStorage.getItem(CONFIG.OPENROUTER_KEY)
        };

        const winnerId = localStorage.getItem(CONFIG.FASTEST_AI_KEY);

        if (winnerId && keys[winnerId]) {
            setStatus('working', `🎯 Usando IA Principal (${winnerId.toUpperCase()})...`);
            try {
                let res;
                if (winnerId === 'nvidia') res = await askNvidia(questions, keys.nvidia);
                else if (winnerId === 'groq') res = await askGroq(questions, keys.groq);
                else if (winnerId === 'openrouter') res = await askOpenRouter(questions, keys.openrouter);
                if (res && Object.keys(res).length > 0) return res;
            } catch (e) {
                setStatus('working', `⚠️ ${winnerId.toUpperCase()} falhou! Recalibrando corrida...`);
                localStorage.removeItem(CONFIG.FASTEST_AI_KEY);
            }
        }

        const activeTasks = [];
        if (keys.nvidia) activeTasks.push(askNvidia(questions, keys.nvidia).then(res => ({ id: 'nvidia', provider: 'NVIDIA 🟢', res })));
        if (keys.groq) activeTasks.push(askGroq(questions, keys.groq).then(res => ({ id: 'groq', provider: 'Groq ⚡', res })));
        if (keys.openrouter) activeTasks.push(askOpenRouter(questions, keys.openrouter).then(res => ({ id: 'openrouter', provider: 'OpenRouter 🐢', res })));

        if (activeTasks.length === 0) throw new Error('Nenhuma chave de IA cadastrada.');

        setStatus('working', `🏎️ Corrida Inicial (${activeTasks.length} IAs)...`);

        try {
            const winner = await Promise.any(activeTasks);
            localStorage.setItem(CONFIG.FASTEST_AI_KEY, winner.id);
            setStatus('working', `🏆 IA Principal definida: ${winner.provider}`);
            await sleep(400);
            return winner.res;
        } catch (aggregateError) {
            throw new Error(`Todas as IAs ativas falharam ou estouraram tempo limite de ${CONFIG.TIMEOUT/1000}s.`);
        }
    }

    async function handleQuizTakePage() {
        setStatus('working', 'Lendo questões da avaliação...');
        await sleep(1200);

        const questions = extractQuestionsFromDOM();
        const quizId = window.location.pathname.match(/\/quizzes\/(\d+)/)?.[1];
        
        if (questions.length === 0) {
            setStatus('error', '⚠ Nenhuma questão detectada.');
            await sleep(1000);
            jumpToNextTarget();
            return;
        }

        const cacheKey = `tic_gabaritos_cache_${COURSE_ID}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
        let gabarito = cache[quizId];

        if (!gabarito || Object.keys(gabarito).length === 0) {
            try {
                gabarito = await askIA(questions);
                cache[quizId] = gabarito;
                localStorage.setItem(cacheKey, JSON.stringify(cache));
            } catch (e) {
                setStatus('error', `⚠ IA falhou: ${e.message}. Recarregando...`);
                localStorage.removeItem(CONFIG.FASTEST_AI_KEY);
                await sleep(2500);
                window.location.reload();
                return;
            }
        }

        let marcadas = 0;
        for (const q of questions) {
            if (q.type === 'radio' && q.options) {
                const feitoOpt = q.options.find(o => /^feito$/i.test(o.text.trim()) || /^sim$/i.test(o.text.trim()));
                if (feitoOpt) {
                    const radio = document.querySelector(`input[type="radio"][name="${q.name}"][value="${feitoOpt.id}"]`);
                    if (radio) {
                        const labelRow = radio.closest('.answer_row') || document.querySelector(`label[for="${radio.id}"]`);
                        if (labelRow) labelRow.click(); else radio.click();
                        marcadas++;
                        continue;
                    }
                }
            }

            const val = gabarito[q.name];
            if (!val) continue;

            const radio = document.querySelector(`input[type="radio"][name="${q.name}"][value="${val}"]`);
            if (radio) {
                const labelRow = radio.closest('.answer_row') || document.querySelector(`label[for="${radio.id}"]`);
                if (labelRow) labelRow.click(); else radio.click();
                marcadas++;
                continue;
            }

            if (Array.isArray(val)) {
                val.forEach(v => {
                    const cb = document.querySelector(`input[type="checkbox"][name="${q.name}"][value="${v}"]`);
                    if (cb && !cb.checked) {
                        const labelRow = cb.closest('.answer_row') || document.querySelector(`label[for="${cb.id}"]`);
                        if (labelRow) labelRow.click(); else cb.click();
                        marcadas++;
                    }
                });
                continue;
            }

            const selectEl = document.querySelector(`select[name="${q.name}"], select#${q.name}`);
            if (selectEl) {
                selectEl.value = val;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                marcadas++;
                continue;
            }

            const textarea = document.querySelector(`textarea[name="${q.name}"]`);
            if (textarea && injectText(textarea, val)) {
                marcadas++;
            }
        }

        // RECUPERAÇÃO AUTOMÁTICA EM CASO DE ZERO OPÇÕES MARCADAS
        if (marcadas === 0) {
            setStatus('error', '⚠ Nenhuma alternativa marcada. Recalibrando...');
            delete cache[quizId];
            localStorage.setItem(cacheKey, JSON.stringify(cache));
            localStorage.removeItem(CONFIG.FASTEST_AI_KEY);
            await sleep(2000);
            window.location.reload();
            return;
        }

        setStatus('working', `✓ ${marcadas} marcadas. Enviando...`);
        await sleep(CONFIG.DELAY_QUIZ);
        document.querySelector('#submit_quiz_button')?.click();
    }

    async function handleQuizResultPage() {
        setStatus('working', 'Verificando nota obtida...');
        await sleep(1500);

        const path = window.location.pathname;
        const currentQuizId = path.match(/\/quizzes\/(\d+)/)?.[1];

        const txt = document.body.innerText;
        const m = txt.match(/Pontuação\s+(?:atual|mantida):\s*(\d+)\s*de\s*10/i) || txt.match(/(\d+)\s*de\s*10/);

        if (m) {
            const score = parseInt(m[1]);
            
            if (score < CONFIG.MIN_SCORE) {
                const retryBtn = document.querySelector('a[href*="/take"]') || 
                                 Array.from(document.querySelectorAll('a, button')).find(el => /Fazer o teste novamente|Retomar o teste/i.test(el.innerText));

                if (retryBtn) {
                    setStatus('working', `🔄 Nota ${score}/10 abaixo do limite. Refazendo teste...`);
                    const cacheKey = `tic_gabaritos_cache_${COURSE_ID}`;
                    const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
                    if (currentQuizId) delete cache[currentQuizId];
                    localStorage.setItem(cacheKey, JSON.stringify(cache));

                    await sleep(1000);
                    retryBtn.click();
                    return;
                }

                setStatus('error', `⛔ NOTA REPROVADA: ${score}/10. (Mínima: ${CONFIG.MIN_SCORE}). Autopilot pausado!`);
                stopAutopilot();
                return;
            }

            if (currentQuizId) markSkipped(currentQuizId);
            setStatus('working', `✓ APROVADO! Nota ${score}/10. Saltando...`);
            await sleep(600);
            jumpToNextTarget();
        } else {
            if (currentQuizId) markSkipped(currentQuizId);
            jumpToNextTarget();
        }
    }

    async function boot() {
        if (!isRunning) return;
        const p = window.location.pathname;
        if (!p.includes(`/courses/${CONFIG.COURSE_ID}`)) return;

        if (isCertificateScreen()) {
            setStatus('done', '🎓 Tela de Certificado alcançada! Download pronto.');
            stopAutopilot();
            return;
        }

        if (/\/quizzes\/\d+\/take/.test(p)) {
            await handleQuizTakePage();
            return;
        }
        
        if (/\/quizzes\/\d+\/submissions/.test(p) || p.includes('/history?')) {
            await handleQuizResultPage();
            return;
        }

        if (/\/quizzes\/\d+$/.test(p) || /\/quizzes\/\d+\?/.test(p)) {
            setStatus('working', 'Verificando capa do Quiz...');
            await sleep(1000);

            const bodyText = document.body.innerText;
            const currentQuizId = p.match(/\/quizzes\/(\d+)/)?.[1];

            const scoreMatch = bodyText.match(/Pontuação\s+(?:atual|mantida):\s*(\d+)\s*de\s*10/i) || bodyText.match(/(\d+)\s*de\s*10/);

            const startBtn = document.querySelector('a[href*="/take"]') ||
                             document.querySelector('.take_quiz_button') ||
                             Array.from(document.querySelectorAll('a, button')).find(el => /Fazer o teste|Retomar o teste|Iniciar teste/i.test(el.innerText));

            if (scoreMatch) {
                const score = parseInt(scoreMatch[1]);
                if (score >= CONFIG.MIN_SCORE) {
                    if (currentQuizId) markSkipped(currentQuizId);
                    setStatus('working', `✓ Quiz já concluído (${score}/10). Saltando...`);
                    await sleep(500);
                    jumpToNextTarget();
                    return;
                } else if (startBtn) {
                    const cacheKey = `tic_gabaritos_cache_${COURSE_ID}`;
                    const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
                    if (currentQuizId) delete cache[currentQuizId];
                    localStorage.setItem(cacheKey, JSON.stringify(cache));

                    setStatus('working', `🔄 Refazendo Quiz reprovado (${score}/10)...`);
                    await sleep(800);
                    startBtn.click();
                    return;
                }
            }

            if (startBtn) {
                startBtn.click();
            } else {
                jumpToNextTarget();
            }
            return;
        }

        const hasQuizContainer = await waitForQuizContainer();
        if (hasQuizContainer) {
            await handleQuizTakePage();
            return;
        }

        jumpToNextTarget();
    }

    await sleep(500);
    createUI();
    if (isRunning) boot();
})();
