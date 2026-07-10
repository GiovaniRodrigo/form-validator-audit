# Form Test Auditor

Extensão WebExtension em Manifest V3 para Chrome, Firefox e Edge, com build separado por navegador e API padronizada por um adaptador local.

## Recursos

- Rastreia URLs do mesmo domínio a partir da página ativa.
- Descobre diretórios por links, assets e actions de formulários.
- Identifica links, botões, handlers declarativos e atributos comuns de frameworks.
- Detecta formulários, campos soltos, campos ocultos e componentes invisíveis.
- Testa valores inválidos e válidos comuns por tipo de campo sem submeter o formulário.
- Inclui heurísticas para Filament, Livewire, Laravel, React, Vue, Angular, Alpine.js e HTMX.
- Exporta relatório completo em JSON pelo popup.
- Abre o relatório no navegador em uma página resumida, com gráficos, tabela filtrável por status, framework, ocultos e prints, ordenação por coluna e detalhes expansíveis.
- Imprime um layout próprio baseado nos filtros ativos, com resumo, tabelas, listas de tópicos relacionados e imagens anexadas.
- Gera um print automático da página quando há erro de validação client-side e anexa a imagem ao relatório.
- Captura prints em abas de segundo plano via permissão `debugger`, evitando ativar a aba auditada durante o processo.

## Como usar

1. Instale as dependências com `npm install`.
2. Gere os pacotes com `npm run build`.
3. Para Chrome/Edge, abra `chrome://extensions`, ative o modo de desenvolvedor, clique em `Carregar sem compactação` e selecione `dist/chrome`.
4. Para Firefox, abra `about:debugging#/runtime/this-firefox`, clique em `Carregar extensão temporária` e selecione `dist/firefox/manifest.json`.
5. Abra a página inicial do domínio que deseja auditar.
6. Clique no ícone da extensão e inicie a auditoria.

## Builds

- `npm run build`: gera `dist/chrome` e `dist/firefox`.
- `npm run build:chrome`: gera apenas o pacote para Chrome/Edge.
- `npm run build:firefox`: gera apenas o pacote para Firefox.

O código-fonte usa um módulo local em `src/browser-api.js` para expor a API `browser` tanto em navegadores que já têm esse namespace quanto no Chrome, que fornece `chrome.*`. O `esbuild` empacota esse adaptador nos arquivos finais.

## Observações

A extensão evita submissões reais. Os testes são feitos alterando valores no DOM, disparando eventos de `input`, `change` e `blur`, e lendo a validação HTML5 quando disponível. Formulários que validam exclusivamente no servidor aparecem no relatório, mas erros de servidor não serão provocados automaticamente.
