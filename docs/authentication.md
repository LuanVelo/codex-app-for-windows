# Autenticação v1 (OAuth-first)

## Objetivo
Implementar autenticação padrão do app com OAuth 2.1 + PKCE para login de usuário e manutenção de sessão segura no Windows.

## Escopo da v1
- Login via browser padrão do sistema
- Callback local com validação de `state`
- Troca de `authorization_code` por tokens
- Renovação automática via `refresh_token`
- Logout local e limpeza de credenciais

## Fluxo de alto nível
1. Usuário clica em "Entrar".
2. App gera `code_verifier`, `code_challenge`, `state` e `nonce`.
3. App abre browser com URL de autorização.
4. Provedor redireciona para callback local com `code` + `state`.
5. App valida `state` e troca `code` por tokens.
6. App salva `refresh_token` no Windows Credential Manager.
7. App mantém `access_token` em memória e inicia sessão.
8. Ao expirar token, app renova automaticamente usando refresh token.

## Componentes
- `AuthService` (aplicação): coordena login, refresh e logout.
- `OAuthClient` (infra): cria URL de autorização e executa token exchange.
- `CallbackServer` (infra): loopback HTTP local para receber callback.
- `TokenStore` (infra): abstração de armazenamento seguro de credenciais.
- `SessionStore` (aplicação/UI): estado atual de autenticação e perfil.

## Contratos sugeridos
```ts
interface AuthService {
  login(): Promise<AuthSession>;
  refresh(): Promise<AuthSession>;
  logout(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
}

interface TokenStore {
  saveRefreshToken(token: string): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  clear(): Promise<void>;
}
```

## Segurança
- Nunca persistir `access_token` em disco.
- Persistir apenas `refresh_token`, em cofre seguro do sistema.
- Validar obrigatoriamente `state` no callback.
- Usar PKCE (`S256`) em todos os fluxos.
- Aplicar timeout de login e invalidar tentativa incompleta.
- Redigir segredos em logs e telemetria.

## Erros e UX
- `callback_timeout`: mostrar ação "Tentar novamente".
- `state_mismatch`: abortar fluxo e recomeçar login.
- `invalid_grant` no refresh: exigir novo login.
- Sem rede: modo offline sem sessão autenticada.

## Telemetria mínima
- `auth_login_started`
- `auth_login_success`
- `auth_login_failed`
- `auth_refresh_success`
- `auth_refresh_failed`
- `auth_logout`

## Plano de implementação
1. Criar interfaces de `AuthService` e `TokenStore`.
2. Implementar `TokenStore` com Windows Credential Manager.
3. Implementar `OAuthClient` + geração PKCE.
4. Implementar `CallbackServer` loopback.
5. Integrar estado global de sessão na UI.
6. Adicionar testes de fluxo (sucesso, timeout, state inválido, refresh inválido).
