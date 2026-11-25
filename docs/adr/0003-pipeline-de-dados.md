---
title: ADR-0003
status: proposed
date: 2026-11-24
owners:
  - Gabriel
tags:
  - data
  - etl
  - python
  - postgresql
supersedes: null
superseded_by: null
---

# 0003: Pipeline de dados históricos em Python com pandas gravando no PostgreSQL do back-end

## Context

Todo o histórico comercial e financeiro da DistriLux anterior a outubro de 2026 existe exclusivamente em três planilhas preenchidas manualmente (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx` e `titulos.csv`, somando 23.801 linhas). Os arquivos apresentam múltiplas inconsistências de formato (datas em 5 padrões + seriais numéricos do Excel, valores monetários em reais/milhares/negativos, quantidades com unidades, códigos em caixa mista, apelidos de vendedores, duplicatas exatas e conflitantes, estornos e registros sem código).

Esse histórico limpo é pré-requisito simultâneo para:

1. Comparação histórica de períodos no painel comercial do portal web e no app mobile;
2. Engenharia de variáveis (`ChurnFeature`, task `S1-08`) e treinamento do modelo de predição de churn na Sprint 2.

Ao mesmo tempo, a API principal do portal está construída em Node.js/TypeScript com PostgreSQL gerenciado via Prisma (`prisma/schema.prisma`), e o cadastro oficial de clientes e produtos é sincronizado a partir do ERP (`RN-09`, `RN-16`).

## Decision

Adotamos **Python 3.11+ com `pandas`, `openpyxl`, `psycopg` e `pytest`** dentro da pasta `data/` do repositório `backend-pta-squad-lucas`, gravando diretamente nas tabelas de histórico (`HistoricalOrderItem`, `HistoricalReceivable` e `LoadIssue`) no **mesmo banco PostgreSQL** do back-end.

Regras que futuras alterações devem preservar:

- **Fonte única do schema:** a definição e evolução das tabelas pertencem exclusivamente ao `prisma/schema.prisma` (migrations gerenciadas pelo Prisma); o pipeline Python apenas lê o catálogo sincronizado do ERP (`Customer`, `Product`) e executa operações de escrita idempotentes nas tabelas de histórico.
- **Separação de camadas:** transformações puras célula-a-célula vivem em `data/pipeline/cleaners.py` (usando `Decimal` para centavos inteiros), enquanto leitura, deduplicação pós-limpeza, reconciliação com o ERP e persistência vivem em `data/pipeline/load_history.py`.
- **Prevalência do ERP (RN-09):** o pipeline histórico nunca sobrescreve registros oficiais sincronizados do ERP (`Customer`, `Product`, `Receivable`).
- **Idempotência e rastreabilidade (RN-16):** toda escrita usa `UPSERT` pelas chaves naturais (`(orderNumber, productErpId)`, `titleNumber` e `(sourceFile, rowNumber, reason)`), registra correções aplicadas e fecha obrigatoriamente a conta `lidas = carregadas + descartadas + pendentes` por arquivo.
- **Dados brutos fora do Git:** `data/raw/` e `data/.venv/` permanecem listados no `.gitignore`.

## Consequences

### Positive

- Aproveita o ecossistema maduro de ciência e engenharia de dados em Python (`pandas`, `openpyxl`, `pytest`), criando continuidade direta com a etapa de engenharia de features (`S1-08`) e o treinamento do modelo de ML na Sprint 2.
- Elimina a necessidade de manter um segundo banco analítico ou infraestrutura extra: a API Node.js, o painel e o pipeline de ML consultam o mesmo PostgreSQL.
- Permite desenvolver e validar toda a limpeza e reconciliação de forma determinística em memória (`--dry-run` e `InMemoryHistoryStore`) mesmo antes da conclusão das migrations do banco.

### Negative

- Introduz um segundo runtime (`Python 3.11+` em ambiente virtual `data/.venv`) dentro de um repositório primariamente Node.js/TypeScript.
- Alterações em nomes de tabelas ou colunas no `prisma/schema.prisma` precisam ser refletidas nas queries SQL parametrizadas do `PostgresHistoryStore` em `data/pipeline/load_history.py`.

## Alternatives considered

### Pipeline de ETL em TypeScript/Node.js com Prisma

Manteria um único runtime no repositório e tipagem compartilhada via Prisma Client. Foi descartada porque a frente de Dados já exigirá Python para engenharia de variáveis (`S1-08`) e modelagem de Machine Learning (Sprint 2), além de o ecossistema `pandas` + `openpyxl` oferecer produtividade e confiabilidade superiores para diagnóstico, limpeza tabular e análise de planilhas Excel heterogêneas.

### Banco de dados separado (SQLite ou DuckDB) para histórico e ML

Evitaria acoplamento inicial com o PostgreSQL do back-end. Foi descartada porque o painel comercial do portal (servido pela API Node.js) e o app mobile precisam consultar os mesmos indicadores históricos e de risco de churn em tempo real, o que exigiria uma sincronização extra desnecessária entre bancos.

## References

- Especificação da task `S1-07-history-load` (`F11 — Carga e Limpeza do Histórico`, parte 1 de 2)
- Regras de negócio `RN-09`, `RN-13` e `RN-16` do PRD DistriLux Portal de Pedidos
- `data/pipeline/cleaners.py`, `data/pipeline/load_history.py` e suíte `data/tests/`
