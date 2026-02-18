# Codex App for Windows

Arquitetura inicial e plano de execução do projeto **Codex App for Windows**.

## Objetivo
Construir um aplicativo desktop para Windows com foco em:
- execução local de sessões Codex;
- integração com API (LLM, autenticação e telemetria);
- terminal embutido;
- gerenciamento de projetos/workspaces;
- automações e extensibilidade por skills.

## Stack definida (MVP)
- **Desktop shell:** Tauri v2 (Rust)
- **UI:** React + TypeScript + Vite
- **State management:** Zustand
- **Data fetching/cache:** TanStack Query
- **Terminal embutido:** xterm.js
- **Persistência local:** SQLite (via plugin Tauri)
- **Observabilidade:** OpenTelemetry + Sentry
- **CI/CD:** GitHub Actions

## Estratégia de distribuição Windows
- **Padrão:** build portátil (`.exe` + arquivos em `.zip`, sem instalador)
- **Opcional:** instalador (`NSIS/MSI`) para canal corporativo
- **Política:** manter compatibilidade com execução sem privilégio administrativo

## Estratégia de autenticação (v1)
- **Padrão:** login `OAuth 2.1 + PKCE` (browser externo + callback local)
- **Sessão:** access token em memória e refresh token em cofre seguro do Windows
- **Fallback futuro:** modo API key para cenários enterprise específicos

## Estrutura do repositório
```text
.
├── docs/
│   ├── architecture.md
│   ├── authentication.md
│   ├── roadmap.md
│   └── adr/
│       ├── 0001-architecture-style.md
│       └── 0002-desktop-framework.md
│       └── 0003-windows-portable-first.md
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
        └── ci.yml
```

## Entregáveis desta fase
- Arquitetura base documentada
- Decisões técnicas iniciais (ADR)
- Roadmap de implementação
- Repositório GitHub criado

## Próximos passos
1. Inicializar app Tauri + React.
2. Implementar autenticação e gestão de sessão.
3. Criar módulo de terminal e execução de comandos.
4. Publicar build Windows portátil (zip) como artefato padrão.

## Desenvolvimento
- App desktop: `src/apps/desktop`
- Rodar local: `cd src/apps/desktop && npm install && npm run tauri dev`
- Build local sem instalador: `cd src/apps/desktop && npm run tauri build -- --no-bundle`

## Build portátil para outro PC
- Workflow: `.github/workflows/windows-portable.yml`
- Saída: artifact `codex-app-for-windows-portable.zip` no GitHub Actions
- Execução no Windows alvo: descompactar e abrir `CodexApp.exe`
