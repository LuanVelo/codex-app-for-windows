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

## Estrutura do repositório
```text
.
├── docs/
│   ├── architecture.md
│   ├── roadmap.md
│   └── adr/
│       ├── 0001-architecture-style.md
│       └── 0002-desktop-framework.md
│       └── 0003-windows-portable-first.md
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
