# ScriptTIC

**TIC em Trilhas — Autopilot v17.0** é um userscript para Tampermonkey que percorre automaticamente as trilhas de um curso no Canvas (TIC em Trilhas), responde quizzes com apoio de IA e avança até a tela de certificado.

As chaves de API e parâmetros sensíveis ficam em um **`.env` local**, injetado no momento do build. O código-fonte não contém segredos.

> ⚠️ **Aviso:** este projeto automatiza a resolução de atividades avaliativas. Use apenas em cursos/ambientes em que isso seja permitido. O uso pode violar os Termos de Uso da plataforma e as regras da instituição. **Nunca** commite o `.env` nem o `dist/` — ambos são ignorados pelo Git.

---

## Sumário

- [Como funciona](#como-funciona)
- [Instalação](#instalação)
- [Configuração via `.env`](#configuração-via-env)
- [Configuração das chaves de IA](#configuração-das-chaves-de-ia)
- [Uso](#uso)
- [Fluxo de execução](#fluxo-de-execução)
- [Provedores e modelos](#provedores-e-modelos)
- [Sistema de respostas (IA)](#sistema-de-respostas-ia)
- [Auto-recuperação](#auto-recuperação)
- [Armazenamento local](#armazenamento-local)
- [Estrutura do código](#estrutura-do-código)
- [Solução de problemas](#solução-de-problemas)
- [Limitações](#limitações)

---

## Como funciona

O script roda apenas em páginas de curso da plataforma:

```
https://ticemtrilhas.instructure.com/courses/*
```

Ao carregar a página, ele:

1. Extrai o **ID do curso** da URL (`/courses/<ID>/...`).
2. Injeta um **painel flutuante** no canto inferior direito.
3. Semeia as chaves vindas do build (`.env`) no `localStorage`, **somente se** ainda não houver uma chave salva pelo painel.
4. Se o autopilot estiver ativo (`localStorage: tic_autopilot_status = "on"`), executa o `boot()` e decide o que fazer conforme a página atual.

O objetivo é percorrer a fila de itens pendentes do curso: **quizzes** e **assignments** são visitados e resolvidos; **páginas** são marcadas como concluídas via API; ao final, o script clica em "Próximo" até encontrar a tela de certificado, onde para.

### O painel

| Elemento | Função |
| --- | --- |
| `▶ Iniciar Autopilot / ⏸ Pausar` | Liga/desliga a automação e reinicia a fila |
| `⚙️` | Abre/fecha o painel de chaves de API |
| `⏭ Pular este Item (Manual)` | Marca o quiz/assignment atual como pulado e vai para o próximo |
| Indicador de estado | `idle`, `working`, `error`, `done` |
| Linha de mensagem | Mostra etapa atual, provedor de IA escolhido, notas etc. |

---

## Instalação

1. Instale a extensão **[Tampermonkey](https://www.tampermonkey.net/)** no seu navegador.
2. Escolha uma das opções abaixo para obter o userscript.
3. No dashboard do Tampermonkey: **Criar novo script** → apague o conteúdo padrão → cole o script → salve (`Ctrl+S`).
4. Acesse qualquer página de curso em `https://ticemtrilhas.instructure.com/courses/<ID>/...`.
5. O painel **🎓 Autopilot v17.0** aparecerá no canto inferior direito.

### Opção A — build com `.env` (recomendado)

```bash
git clone https://github.com/santanazfx/ScriptTIC.git
cd ScriptTIC
cp .env.example .env      # preencha as chaves
node build.mjs            # ou: npm run build
```

Instale no Tampermonkey o arquivo gerado **`dist/tic-autopilot.user.js`**. As chaves do `.env` entram no build e passam a ser o padrão.

### Opção B — sem build

Instale o arquivo **`tic-autopilot.user.js`** diretamente e informe as chaves pelo painel **⚙️**. O fonte é válido e funcional, mas não contém nenhuma chave.

Não é necessária nenhuma permissão especial (`@grant none`). O script usa as credenciais da própria sessão do Canvas para chamar a API do curso.

### Estrutura do repositório

| Arquivo | Vai para o Git? | Papel |
| --- | --- | --- |
| `tic-autopilot.user.js` | Sim | Fonte do userscript. Funciona sem build, mas sem chaves padrão. |
| `build.mjs` | Sim | Lê o `.env`, injeta no bloco `<ENV>` e gera o `dist/`. |
| `.env.example` | Sim | Modelo comentado de todas as variáveis. |
| `.env` | **Não** | Suas chaves e parâmetros reais. Criado por você a partir do exemplo. |
| `dist/tic-autopilot.user.js` | **Não** | Build final com as chaves injetadas. É o arquivo que vai para o Tampermonkey. |
| `package.json` | Sim | Atalho `npm run build`; não possui dependências. |
| `README.md` | Sim | Esta documentação. |

---

## Configuração via `.env`

### Por que existe um passo de build

Userscripts executam dentro do navegador. Eles **não conseguem abrir um arquivo `.env` do disco**, e o Tampermonkey também não lê variáveis de ambiente. Para o script usar uma chave, ela precisa estar dentro do próprio código instalado (ou no `localStorage`).

O projeto resolve isso com um build local:

```
.env  ──►  build.mjs  ──►  dist/tic-autopilot.user.js  ──►  Tampermonkey
(local)    (injeta)        (arquivo instalável)             (executa)
             ▲
             └── tic-autopilot.user.js (fonte, sem segredos)
```

- O **fonte** `tic-autopilot.user.js` fica no Git e não contém chaves.
- O **build** lê o `.env`, substitui o bloco `<ENV>` e grava `dist/tic-autopilot.user.js`.
- O **dist** é o arquivo que você instala. Ele contém as chaves e por isso **não vai para o Git**.

A lógica do autopilot não mudou: apenas a origem das chaves e dos parâmetros passou a ser o `.env` (com o painel ainda funcionando como antes).

### Passo a passo

1. Copie o modelo:

   ```bash
   cp .env.example .env
   ```

2. Abra o `.env` e preencha pelo menos uma chave. Exemplo:

   ```env
   TIC_NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxx
   TIC_GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxx
   TIC_OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx
   TIC_MIN_SCORE=6
   TIC_DELAY_QUIZ=1800
   TIC_TIMEOUT=12000
   TIC_OPENROUTER_REFERER=https://ticemtrilhas.instructure.com
   ```

   Os valores acima são fictícios. Use chaves reais apenas no seu `.env` local.

3. Gere o arquivo final:

   ```bash
   node build.mjs
   # ou
   npm run build
   ```

   Saída esperada:

   ```
   ✔ Gerado: dist/tic-autopilot.user.js
   ```

   Se nenhuma chave estiver preenchida, o build avisa:

   ```
   ⚠ Sem chave padrão para: NVIDIA_KEY, GROQ_KEY, OPENROUTER_KEY (preencha o .env ou use o painel ⚙️).
   ```

4. Instale o **`dist/tic-autopilot.user.js`** no Tampermonkey (crie um script novo e cole o conteúdo, ou reinstale o arquivo).
5. Recarregue a página do curso.

### Referência das variáveis

| Variável | Padrão | Descrição | Exige rebuild? |
| --- | --- | --- | --- |
| `TIC_NVIDIA_API_KEY` | vazio | Chave NVIDIA (`nvapi-...`) | Sim para virar padrão; o painel pode sobrescrever |
| `TIC_GROQ_API_KEY` | vazio | Chave Groq (`gsk_...`) | Sim para virar padrão; o painel pode sobrescrever |
| `TIC_OPENROUTER_API_KEY` | vazio | Chave OpenRouter (`sk-or-...`) | Sim para virar padrão; o painel pode sobrescrever |
| `TIC_MIN_SCORE` | `6` | Nota mínima para aprovar (0–10) | Sim |
| `TIC_DELAY_QUIZ` | `1800` | Espera antes de enviar o quiz (ms) | Sim |
| `TIC_TIMEOUT` | `12000` | Timeout por tentativa de IA (ms) | Sim |
| `TIC_OPENROUTER_REFERER` | `https://ticemtrilhas.instructure.com` | Header `HTTP-Referer` enviado ao OpenRouter | Sim |

### Como o valor chega ao código

O `build.mjs` localiza este bloco no fonte:

```js
// <ENV>
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
```

e o substitui pelos valores do `.env`:

```js
// <ENV>
const ENV = {
    NVIDIA_KEY: "nvapi-...",
    GROQ_KEY: "gsk_...",
    OPENROUTER_KEY: "sk-or-...",
    MIN_SCORE: "6",
    DELAY_QUIZ: "1800",
    TIMEOUT: "12000",
    OPENROUTER_REFERER: "https://ticemtrilhas.instructure.com"
};
// </ENV>
```

No carregamento, `seedEnvKey()` copia as chaves para o `localStorage` **apenas quando ainda não existe uma chave salva**:

```js
const seedEnvKey = (storageKey, value) => {
    if (value && !localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, value);
    }
};

seedEnvKey(CONFIG.NVIDIA_KEY, ENV.NVIDIA_KEY);
seedEnvKey(CONFIG.GROQ_KEY, ENV.GROQ_KEY);
seedEnvKey(CONFIG.OPENROUTER_KEY, ENV.OPENROUTER_KEY);
```

Depois disso, o restante do código continua igual: todas as chamadas de IA leem a chave do `localStorage`, como já faziam antes.

### Precedência das chaves

| Cenário | Chave usada |
| --- | --- |
| Painel preenchido + `.env` preenchido | **Painel** (`localStorage`) |
| Painel vazio + `.env` preenchido | **`.env`** (semeada no carregamento) |
| Painel preenchido + `.env` vazio | **Painel** |
| Nenhum dos dois | Nenhuma — o painel pede uma chave |

> Se você apagar uma chave pelo painel, ela sai do `localStorage`. No próximo recarregamento, se o `.env` ainda tiver essa chave, ela volta a ser semeada. Para removê-la de vez, apague do `.env` e rode o build novamente.

### Chaves x parâmetros

- **Chaves de API**: podem ser trocadas pelo painel ⚙️ sem rebuild. O `.env` define o valor inicial.
- **Parâmetros** (`TIC_MIN_SCORE`, `TIC_DELAY_QUIZ`, `TIC_TIMEOUT`, `TIC_OPENROUTER_REFERER`): não têm interface no painel; só mudam com rebuild.

### Atualizar configurações

| O que mudar | Como fazer |
| --- | --- |
| Chave de API (rápido) | Painel ⚙️ → **Salvar Chaves** |
| Chave de API (padrão do build) | Editar `.env` → `node build.mjs` → reinstalar o `dist/` |
| Nota mínima, delays ou timeout | Editar `.env` → `node build.mjs` → reinstalar o `dist/` |
| Listas de modelos | Editar `CONFIG.*_MODELS` no fonte → `node build.mjs` → reinstalar o `dist/` |

### Segurança

- O `.env` é **ignorado pelo Git**; apenas `.env.example` é versionado.
- O `dist/` também é ignorado, mas **contém as chaves em texto puro**. Trate-o como segredo: não envie, não anexe e não publique.
- O build aborta se detectar padrão de chave hardcoded no fonte (`nvapi-`, `gsk_`, `sk-or-`).
- O Tampermonkey guarda o script instalado. Quem tiver acesso ao perfil do navegador pode ler as chaves.
- Se uma chave vazar, **revogue no provedor e gere outra**. Apenas trocar o `.env` não invalida a chave antiga.
- O aviso de uso responsável no topo deste README continua valendo.

### Verificar o resultado

```bash
node --check dist/tic-autopilot.user.js   # confere a sintaxe
```

O build também imprime um aviso quando alguma chave ficou vazia, o que ajuda a detectar `.env` incompleto.

---

## Configuração das chaves de IA

Você precisa de **pelo menos uma** chave, informada de uma destas formas:

- **`.env` + build** (vira padrão inicial — veja acima);
- **painel ⚙️** (salva no `localStorage` e tem prioridade sobre o `.env`).

| Provedor | Onde obter | Prefixo esperado |
| --- | --- | --- |
| **NVIDIA NIM** | <https://build.nvidia.com/> | `nvapi-...` |
| **Groq** | <https://console.groq.com/keys> | `gsk_...` |
| **OpenRouter** | <https://openrouter.ai/keys> | `sk-or-...` |

Passos:

1. Clique no ícone **⚙️** no painel.
2. Preencha uma ou mais chaves.
3. Clique em **Salvar Chaves**.

Ao salvar, o script remove o provedor vencedor anterior (`tic_fastest_ai`), forçando uma nova "corrida" entre os provedores disponíveis. Deixar um campo vazio remove a chave correspondente.

> Quanto mais provedores configurados, maior a resiliência: se um falhar ou estourar o tempo limite, os outros continuam concorrendo.

---

## Uso

1. Abra o curso desejado.
2. Configure as chaves (⚙️) na primeira vez.
3. Clique em **▶ Iniciar Autopilot**.
4. Acompanhe as mensagens no painel. O script navega sozinho entre os itens.
5. Para interromper, clique em **⏸ Pausar**. A fila é descartada.
6. Para ignorar um item problemático, use **⏭ Pular este Item**.

O estado do autopilot é persistido: se você recarregar a página, ele continua de onde parou (a fila fica em `sessionStorage` e sobrevive a recarregamentos na mesma aba).

### Regras de decisão

- **Nota mínima:** `MIN_SCORE = 6` (de 10).
- Se a nota do quiz for **≥ 6**, o item é marcado como concluído e o script avança.
- Se for **< 6** e houver botão de refazer, o script limpa o gabarito em cache, refaz o teste e tenta novamente.
- Se não houver como refazer, o autopilot é **pausado** com aviso de reprovação.
- Se a página não expuser a nota, o item é marcado como concluído e o script segue.

---

## Fluxo de execução

```
boot()
 │
 ├─ Tela de certificado?  ──► para o autopilot (done)
 │
 ├─ /quizzes/<id>/take ─────► handleQuizTakePage()
 │                             ├─ extrai questões do DOM
 │                             ├─ consulta cache / IA
 │                             ├─ marca alternativas
 │                             └─ envia após DELAY_QUIZ
 │
 ├─ /quizzes/<id>/submissions
 │  ou /history? ───────────► handleQuizResultPage()
 │                             ├─ lê "Pontuação ... X de 10"
 │                             ├─ < 6? refaz (limpa cache)
 │                             └─ ≥ 6? marca concluído e avança
 │
 ├─ /quizzes/<id> ──────────► capa do quiz
 │                             ├─ já aprovado? pula
 │                             ├─ reprovado? refaz
 │                             └─ senão clica em "Fazer o teste"
 │
 └─ qualquer outra página ──► jumpToNextTarget()
                               ├─ fila vazia? buildTargetQueue()
                               ├─ vai para o próximo item
                               └─ fila vazia e sem "Próximo"? conclui
```

### `buildTargetQueue()`

Monta a fila via API do Canvas:

1. `GET /api/v1/courses/<id>/modules?include[]=items&per_page=100`
2. Ignora módulos já concluídos.
3. Para cada módulo, busca os itens (`.../modules/<moduleId>/items?per_page=500`).
4. Ignora `SubHeader` e itens com `completion_requirement.completed === true`.
5. **Pages** → `PUT .../modules/<moduleId>/items/<itemId>/done` (conclui direto).
6. **Quizzes** e **Assignments** → entram na fila (se não estiverem marcados como pulados).

### `jumpToNextTarget()`

Consome o primeiro item da fila e redireciona para a URL correspondente. Se a fila acabar, tenta clicar no botão **Próximo** do rodapé de sequência do Canvas; se não existir, finaliza o autopilot.

---

## Provedores e modelos

O script tenta os modelos em cascata dentro de cada provedor. Se um modelo falhar (erro HTTP, resposta vazia, timeout), o próximo é tentado.

**NVIDIA**
```
meta/llama-3.3-70b-instruct
nvidia/llama-3.1-nemotron-70b-instruct
meta/llama3-70b-instruct
mistralai/mistral-large-2-instruct
```

**Groq**
```
llama-3.3-70b-versatile
llama-3.1-8b-instant
llama3-70b-8192
mixtral-8x7b-32768
```

**OpenRouter** (modelos gratuitos)
```
meta-llama/llama-3.3-70b-instruct:free
google/gemini-2.0-flash-lite-001:free
deepseek/deepseek-r1:free
openrouter/free
```

- Todas as chamadas usam `temperature` baixa (0.0–0.1) para respostas determinísticas.
- Cada tentativa tem timeout de **12 s** (`CONFIG.TIMEOUT`).
- O vencedor da primeira corrida é memorizado em `tic_fastest_ai` e passa a ser usado como principal nas próximas questões.

---

## Sistema de respostas (IA)

### 1. Extração das questões

`extractQuestionsFromDOM()` percorre `.display_question` / `.question` e suporta:

| Tipo | Como é tratado |
| --- | --- |
| `radio` | Uma opção correta; usa `name` e `value` |
| `checkbox` | Múltiplas corretas; resposta esperada em array |
| `select` | Lacunas / preenchimento; o texto do enunciado é reconstruído com marcadores `___ [CAMPO: nome] ___` |
| `textarea` | Questão dissertativa curta; resposta em texto livre |

### 2. Prompt

O enunciado e as opções são enviados no formato:

```
=== CAMPO: <name> ===
CONTEXTO: <texto da questão>
OPÇÕES DISPONÍVEIS:
  - ID="<id>": "<texto>"
```

O modelo deve responder **apenas** com JSON:

```json
{ "campo": "ID_da_opcao" }
```

### 3. Parser robusto

`parseIAAnswer()` foi feito para tolerar respostas imperfeitas:

- Remove cercas Markdown (```json ... ```).
- Extrai o primeiro bloco `{ ... }` válido.
- Faz **correspondência aproximada de chaves** (case-insensitive e por substring).
- Aceita resposta por **ID** ou por **texto da alternativa**.
- Suporta array para questões de múltipla escolha.

### 4. Marcação e envio

- Radio/checkbox são marcados clicando na `.answer_row` ou no `<label>` (mais confiável no Canvas).
- `select` recebe `value` + evento `change`.
- `textarea` recebe texto via *native setter* + eventos `input`, `change` e `blur`.
- Questões com opção "Feito"/"Sim" são respondidas automaticamente.
- O envio ocorre após `DELAY_QUIZ` (**1800 ms**).

### 5. Cache de gabaritos

Os gabaritos ficam em `localStorage` sob `tic_gabaritos_cache_<courseId>`, indexados pelo ID do quiz. Isso evita gastar tokens ao refazer/revisitar o mesmo teste. O cache é apagado quando o quiz é reprovado.

---

## Auto-recuperação

A v17 foi pensada para não travar em telas pós-IA:

| Situação | Reação |
| --- | --- |
| IA falhou / timeout em todas as tentativas | Limpa o provedor vencedor, espera 2,5 s e **recarrega** a página |
| Nenhuma alternativa foi marcada | Apaga o gabarito do quiz, limpa o vencedor e **recarrega** |
| Provedor principal falhou numa questão | Remove `tic_fastest_ai` e refaz a corrida entre os demais |
| Nota abaixo da mínima | Limpa o cache e reabre o teste, se possível |
| Tela de certificado | Encerra o autopilot (não baixa o certificado automaticamente) |
| Fila vazia | Tenta o botão "Próximo"; se não houver, conclui |

O script também neutraliza diálogos nativos (`confirm`, `alert`, `prompt`) para que a navegação não fique presa.

---

## Armazenamento local

**`localStorage`** (persistente)

| Chave | Conteúdo |
| --- | --- |
| `tic_nvidia_key` | Chave NVIDIA |
| `tic_groq_key` | Chave Groq |
| `tic_openrouter_key` | Chave OpenRouter |
| `tic_fastest_ai` | Provedor vencedor (`nvidia`, `groq`, `openrouter`) |
| `tic_autopilot_status` | `on` / `off` |
| `tic_gabaritos_cache_<courseId>` | Cache de respostas por quiz |

**`sessionStorage`** (por aba)

| Chave | Conteúdo |
| --- | --- |
| `tic_target_queue_<courseId>` | Fila de itens pendentes |
| `tic_skipped_quizzes` | IDs de quizzes/assignments pulados manualmente |

> Ao carregar o script, as chaves definidas no `.env` são copiadas para o `localStorage` **somente se** ainda não existir uma chave salva pelo painel. Depois disso, o comportamento é idêntico ao de uma chave digitada manualmente.

Para "resetar" completamente o script: pause o autopilot e limpe essas chaves no console do navegador (F12).

```js
Object.keys(localStorage)
  .filter(k => k.startsWith('tic_'))
  .forEach(k => localStorage.removeItem(k));
```

---

## Estrutura do código

| Função | Responsabilidade |
| --- | --- |
| `ENV` | Valores injetados pelo build a partir do `.env` |
| `seedEnvKey()` | Copia chaves do `.env` para o `localStorage` sem sobrescrever o painel |
| `createUI()` | Cria o painel flutuante e liga os botões |
| `setStatus(state, msg)` | Atualiza indicador de estado e mensagem |
| `stopAutopilot()` | Desliga, limpa a fila e reseta o botão |
| `boot()` | Roteador principal por URL/tela |
| `buildTargetQueue()` | Mapeia módulos e itens pendentes via API |
| `jumpToNextTarget()` | Navega para o próximo item ou clica em "Próximo" |
| `markPageAsDoneViaAPI()` | Conclui páginas via `PUT .../done` |
| `waitForQuizContainer()` | Aguarda o formulário do quiz renderizar |
| `extractQuestionsFromDOM()` | Lê questões e alternativas do DOM |
| `buildUserPrompt()` | Monta o prompt com o contrato JSON |
| `askNvidia()` / `askGroq()` / `askOpenRouter()` | Cascata de modelos por provedor |
| `askIA()` | Corrida entre provedores + provedor principal |
| `parseIAAnswer()` | Parser tolerante da resposta da IA |
| `injectText()` | Preenche `textarea` respeitando frameworks |
| `handleQuizTakePage()` | Responde e envia o quiz |
| `handleQuizResultPage()` | Avalia nota, refaz ou avança |
| `isCertificateScreen()` | Detecta a tela final de certificado |
| `clickNextButton()` | Fallback para avançar pela sequência do Canvas |

### Constantes principais

```js
const CONFIG = {
    MIN_SCORE: Number(ENV.MIN_SCORE) || 6,       // nota mínima para aprovar
    DELAY_QUIZ: Number(ENV.DELAY_QUIZ) || 1800,  // ms antes de enviar o quiz
    TIMEOUT: Number(ENV.TIMEOUT) || 12000        // ms por tentativa de IA
};
```

Os valores de `ENV` vêm do bloco `<ENV>` injetado por `build.mjs`. No fonte, ficam os padrões acima; a versão compilada traz os valores do seu `.env`.

---

## Solução de problemas

**O painel não aparece**
- Confirme que está em `https://ticemtrilhas.instructure.com/courses/<ID>/...`.
- Verifique se o Tampermonkey está ativo e o script habilitado.
- Recarregue a página.

**Build falha com ".env não encontrado"**
- Rode `cp .env.example .env` na raiz do projeto e preencha as chaves.

**Build avisa que não há chave padrão**
- É apenas um aviso. Preencha as variáveis `TIC_*_API_KEY` no `.env` ou informe as chaves pelo painel ⚙️.

**A chave do `.env` não aparece no painel**
- Uma chave salva anteriormente pelo painel tem prioridade. Limpe a chave (salve o campo vazio) e recarregue a página.

**Alterei o `.env`, mas o script usa outra chave**
- Gere o `dist/` de novo (`node build.mjs`) e reinstale no Tampermonkey.
- Se o painel tiver uma chave salva, ela vence o `.env`. Salve o campo vazio, recarregue e a chave do `.env` volta a ser semeada.

**O painel já abre com a chave do `.env`**
- Comportamento esperado: o build semeia o `localStorage` na primeira carga, e o campo do painel lê esse valor.

**Quero usar sem `.env`**
- Instale `tic-autopilot.user.js` diretamente e informe as chaves pelo painel. O fonte é funcional e não contém chaves.

**O build não gera o `dist/`**
- Confira se o Node.js está instalado (`node --version`) e se o comando foi rodado na raiz do projeto.
- Verifique se o `.env` existe e se os marcadores `<ENV>` continuam no fonte.

**"Insira pelo menos 1 chave de IA"**
- Abra o ⚙️ e salve ao menos uma chave válida (ou preencha o `.env` e rode o build).

**"Todas as IAs ativas falharam"**
- Verifique saldo/limite do provedor (erros `429` são comuns em planos gratuitos).
- Confira se a chave não expirou.
- Remova e recoleque a chave para resetar a corrida.

**"Nenhuma questão detectada"**
- A página pode ter carregado incompleta; o script recarrega sozinho, mas você pode refazer manualmente.
- Layouts fora do padrão Canvas podem não ser reconhecidos.

**"Nenhuma alternativa marcada"**
- O gabarito em cache estava inválido. O script limpa o cache e recarrega; se persistir, use **Pular**.

**Nota abaixo da mínima**
- Se o teste não permitir nova tentativa, o autopilot pausa. Refaça manualmente ou ajuste `MIN_SCORE`.

**Fila não avança**
- Use **Pular** no item atual; a fila é recalculada quando fica vazia.

---

## Limitações

- Depende da estrutura DOM do Canvas; mudanças de layout podem quebrar os seletores.
- Não resolve questões dissertativas longas, envio de arquivos ou tarefas externas.
- Não baixa o certificado — apenas detecta a tela e encerra.
- A fila em `sessionStorage` não é compartilhada entre abas nem sobrevive ao fechamento da aba.
- As chaves ficam em texto puro no `localStorage` **e no `dist/` gerado**; evite usar em computadores compartilhados e nunca commite `.env` ou `dist/`.
- Como o usuário precisa colar o script no Tampermonkey, o build com `.env` embute as chaves no arquivo instalado — isso não adiciona proteção contra quem tem acesso ao navegador.
- Sem rodar o build, o fonte não possui chaves padrão; nesse caso, informe-as pelo painel ⚙️.
- O uso de IA de terceiros pode gerar custos e está sujeito aos limites de cada provedor.

---

## Licença

Defina a licença de sua preferência (MIT, GPL-3.0, etc.). Sem licença explícita, todos os direitos são reservados ao autor.
