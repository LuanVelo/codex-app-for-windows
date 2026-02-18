# ADR 0002: Tauri como framework desktop

## Status
Aceito

## Contexto
Precisamos de app desktop moderno para Windows com baixo consumo de memória e acesso a capacidades nativas.

## Decisão
Adotar Tauri v2 + frontend React/TypeScript.

## Consequências
- Benefício: footprint menor que Electron e bom desempenho.
- Trade-off: necessidade de Rust no toolchain.
