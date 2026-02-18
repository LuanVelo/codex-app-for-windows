# ADR 0003: Estratégia Windows Portable-First

## Status
Aceito

## Contexto
O projeto precisa rodar no Windows sem instalação obrigatória para reduzir barreiras de adoção e facilitar uso em ambientes restritos.

## Decisão
Adotar estratégia **portable-first** para distribuição Windows, mantendo instalador como opção secundária.

## Consequências
- Benefício: onboarding mais rápido e menor dependência de permissões administrativas.
- Benefício: distribuição simples por `.zip` em canais internos.
- Trade-off: auto-update do canal portátil inicialmente manual.
- Trade-off: maior cuidado com gerenciamento de dados locais em modo portátil.
