# Arquitetura do Codex App for Windows

## 1. Princípios arquiteturais
- **Modularidade:** separar UI, domínio e infraestrutura.
- **Offline-first parcial:** app deve funcionar para tarefas locais mesmo sem rede.
- **Segurança por padrão:** segredo em cofre do sistema + criptografia de dados sensíveis.
- **Observabilidade:** logs estruturados, tracing e métricas desde o início.

## 2. Visão em camadas

### Camada de Apresentação (Desktop UI)
- Shell desktop (janela, menu, tray, notificações)
- Workspace manager (abrir/projetos recentes)
- Chat/Tasks view
- Terminal panel
- Settings & credentials

### Camada de Aplicação (Use Cases)
- Orquestração de sessões
- Gerenciamento de automações
- Sincronização de estado com backend
- Regras de negócio de execução e histórico

### Camada de Domínio (Core)
- Entidades: Session, Workspace, AgentTask, Automation, Skill
- Serviços de domínio: TaskPlanner, SessionStateMachine
- Eventos de domínio: TaskStarted, TaskCompleted, CommandExecuted

### Camada de Infraestrutura
- API clients (OpenAI/Codex backend)
- Persistência local (SQLite)
- Sistema de arquivos (projetos, skills, logs)
- Process manager (execução de comandos)
- Telemetria e logging

## 3. Módulos necessários (MVP)
1. **Auth & Profile**
2. **Workspace Management**
3. **Session/Chat Orchestrator**
4. **Terminal Integration**
5. **File Explorer + Diff Viewer**
6. **Automation Scheduler (local)**
7. **Settings (API keys, model, runtime)**
8. **Telemetry & Error Reporting**
9. **Auto-update + Release channel**
10. **Security (credential vault, permissions)**

## 4. Integrações externas
- API principal Codex/LLM
- GitHub API (repos, PRs, issues)
- Sistema operacional Windows (PowerShell, paths, notificações)

## 5. Segurança
- Credenciais em store seguro do sistema (Windows Credential Manager)
- Redação de segredos em logs
- Sandboxing de execução por workspace
- Políticas de confirmação para comandos destrutivos

## 6. Observabilidade
- Log estruturado por módulo
- Error tracking (Sentry)
- Métricas de performance: tempo de resposta, sucesso/falha de comando, crash-free sessions

## 7. Estratégia de evolução
- **Fase 1 (MVP):** sessão, terminal, workspace, autenticação
- **Fase 2:** automações + integração GitHub avançada
- **Fase 3:** plugins/skills marketplace + colaboração
