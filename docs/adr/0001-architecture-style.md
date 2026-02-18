# ADR 0001: Arquitetura em camadas modulares

## Status
Aceito

## Contexto
O aplicativo precisa evoluir rápido sem acoplamento forte entre UI, domínio e infraestrutura.

## Decisão
Adotar arquitetura em camadas com módulos por domínio e contratos explícitos entre camadas.

## Consequências
- Benefício: melhor testabilidade e manutenção.
- Trade-off: maior custo inicial de estruturação.
