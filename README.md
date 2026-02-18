# Codex App for Windows

Aplicativo desktop para Windows, focado em produtividade com agentes Codex: sessões de chat/execução, terminal integrado, gestão de workspaces e automações locais.

## O que é o app
O **Codex App for Windows** é um cliente desktop portátil para executar fluxos de desenvolvimento assistidos por IA em projetos locais. O objetivo é centralizar em uma interface única:
- interação com agente (chat + execução de tarefas);
- contexto de arquivos do workspace;
- execução de comandos no terminal;
- histórico e automações recorrentes.

## Stack tecnológica
- **Shell desktop:** Tauri v2 (Rust)
- **Frontend:** React + TypeScript + Vite
- **Estado local:** Zustand
- **Data fetching/cache:** TanStack Query
- **Terminal:** xterm.js
- **Persistência local:** SQLite
- **Observabilidade:** OpenTelemetry + Sentry
- **CI/CD:** GitHub Actions

## Estratégia de distribuição
- **Padrão:** build portátil Windows (`.exe` + `.zip`)
- **Opcional:** instalador (`NSIS/MSI`) para canais corporativos
- **Execução:** sem necessidade de permissão de administrador no fluxo padrão

## Estratégia de autenticação (v1)
- **Padrão:** `OAuth 2.1 + PKCE` (browser externo + callback local)
- **Tokens:** `access_token` em memória, `refresh_token` em armazenamento seguro
- **Evolução:** suporte a API key como fallback enterprise

## Estrutura de dados
### Entidades principais
- `Workspace`: projeto local aberto no app
- `Session`: conversa/sessão de execução com o agente
- `Message`: mensagens do usuário e do agente
- `CommandExecution`: histórico de comandos executados
- `Automation`: tarefa recorrente configurada no app
- `AuthSession`: estado de autenticação OAuth

### Modelo lógico inicial (local)
- `workspaces`
- `sessions`
- `messages`
- `command_executions`
- `automations`
- `settings`
- `audit_events`

### Regras de dados
- sessão ativa em memória para resposta rápida da UI;
- histórico e configurações persistidos em SQLite;
- dados sensíveis fora do SQLite quando necessário (ex.: credenciais/tokens);
- logs com redação de segredos.

## Funcionalidades
### MVP (v1)
- Login OAuth com ciclo de sessão (login, refresh, logout)
- Gestão de workspaces locais
- Chat com agente por sessão
- Terminal integrado para execução de comandos
- Histórico local de sessões e comandos
- Build portátil para execução sem instalação

### Pós-MVP
- Scheduler de automações recorrentes
- Integração com GitHub (issues, PRs e contexto de repositório)
- Diff viewer com aplicação de patch
- Sistema de skills/plugins
- Canais de release (beta/stable) e telemetria avançada

## Estrutura do repositório
```text
.
├── docs/
│   ├── architecture.md
│   ├── authentication.md
│   ├── roadmap.md
│   └── adr/
│       ├── 0001-architecture-style.md
│       ├── 0002-desktop-framework.md
│       ├── 0003-windows-portable-first.md
│       └── 0004-auth-oauth-first.md
├── src/
│   ├── apps/
│   │   └── desktop/
│   ├── core/
│   ├── services/
│   ├── infrastructure/
│   └── shared/
└── .github/
    └── workflows/
        ├── ci.yml
        └── windows-portable.yml
```

## Desenvolvimento
- App desktop: `/Users/luancarneiro/Library/CloudStorage/GoogleDrive-luan@velodigital.com.br/My Drive/Design Lab/Codex testing/codex windows/src/apps/desktop`
- Rodar local:
  - `cd src/apps/desktop`
  - `npm install`
  - `npm run tauri dev`
- Build local sem instalador:
  - `cd src/apps/desktop`
  - `npm run tauri build -- --no-bundle`

## Build portátil para outro PC
- Workflow: `/Users/luancarneiro/Library/CloudStorage/GoogleDrive-luan@velodigital.com.br/My Drive/Design Lab/Codex testing/codex windows/.github/workflows/windows-portable.yml`
- Saída: artifact `codex-app-for-windows-portable.zip`
- Execução no Windows alvo: descompactar e abrir `CodexApp.exe`
