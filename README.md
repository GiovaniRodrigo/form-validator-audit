# Form Test Auditor

Extensão Chrome em Manifest V3 para rastrear páginas de um domínio e gerar relatório de formulários, campos, componentes ocultos, botões/links de navegação e testes de validação client-side.

## Recursos

- Rastreia URLs do mesmo domínio a partir da página ativa.
- Descobre diretórios por links, assets e actions de formulários.
- Identifica links, botões, handlers declarativos e atributos comuns de frameworks.
- Detecta formulários, campos soltos, campos ocultos e componentes invisíveis.
- Testa valores inválidos e válidos comuns por tipo de campo sem submeter o formulário.
- Inclui heurísticas para Filament, Livewire, Laravel, React, Vue, Angular, Alpine.js e HTMX.
- Exporta relatório completo em JSON pelo popup.
- Abre o relatório no navegador em uma página resumida, com gráficos, tabela filtrável, ordenação por coluna, detalhes expansíveis e opção de impressão.

## Como usar

1. Abra `chrome://extensions`.
2. Ative o modo de desenvolvedor.
3. Clique em `Carregar sem compactação`.
4. Selecione esta pasta.
5. Abra a página inicial do domínio que deseja auditar.
6. Clique no ícone da extensão e inicie a auditoria.

## Observações

A extensão evita submissões reais. Os testes são feitos alterando valores no DOM, disparando eventos de `input`, `change` e `blur`, e lendo a validação HTML5 quando disponível. Formulários que validam exclusivamente no servidor aparecem no relatório, mas erros de servidor não serão provocados automaticamente.
