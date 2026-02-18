# ADR 0004: Estratégia de autenticação OAuth-first

## Status
Aceito

## Contexto
A v1 do app precisa oferecer autenticação de usuário consistente com experiência moderna de desktop, sem depender de entrada manual de API key como fluxo principal.

## Decisão
Adotar OAuth 2.1 com Authorization Code + PKCE como fluxo padrão de autenticação da primeira versão.

## Consequências
- Benefício: UX melhor e gerenciamento de sessão mais alinhado ao login de conta.
- Benefício: menor exposição de segredos pelo usuário final.
- Trade-off: complexidade adicional de callback local e ciclo de refresh token.
- Trade-off: dependência explícita de endpoints OAuth do provedor.
