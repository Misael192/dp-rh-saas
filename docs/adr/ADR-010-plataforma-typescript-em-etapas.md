# ADR-010 — Plataforma TypeScript e entrega incremental

Status: adotado para a Etapa 1. Data: 2026-10-10.

Contexto histórico: esta decisão foi tomada no repositório `Misael192.github.io`. A localização atual da plataforma na raiz de `dp-rh-saas` está definida em [ADR-011](ADR-011-repositorio-dp-rh-saas.md); os princípios de arquitetura abaixo continuam válidos.

O repositório contém um MVP PHP e uma migração Laravel. O usuário determinou a stack Next.js 15/NestJS/Prisma/PostgreSQL/Redis e entregas com aprovação entre etapas. A nova implementação fica em `platform/`, preservando o legado durante a transição. Não existe migração automática dos dados legados nesta etapa.

Adotamos monorepo npm e monólito modular NestJS. Next.js funciona como interface e proxy de mesma origem; o navegador usa cookies HttpOnly e nunca recebe JWT no JSON. Contratos Zod são compartilhados. O domínio de colaboradores possui porta de repositório, serviço de aplicação e adaptador Prisma. Microserviços ficam condicionados a necessidade operacional demonstrada.

O contexto tenant/empresa vem da sessão verificada. Cada operação privada usa transação com `set_config(..., true)` e role PostgreSQL sem superuser/BYPASSRLS. RLS `FORCE`, FKs compostas e filtros explícitos dão camadas complementares de isolamento. Migração/provisionamento usam credencial administrativa separada, nunca no serviço HTTP de produção.

Prisma 6.19.3 usa `engineType="client"` e o adaptador oficial `PrismaPg`, evitando um engine Rust no runtime. A configuração `generate-only.config.ts` permite geração/validação sem engine nativo e bloqueia migrations. Deploy de migrations permanece na CLI padrão com verificação oficial de downloads. O bloqueio de rede deste workspace está registrado no log; não autoriza desligar TLS ou checksums.

Entregamos apenas os domínios já testados. Folha, férias, ponto, recrutamento, storage, financeiro, IA e integrações entram em etapas aprovadas separadamente, com schema e testes próprios. Esta decisão substitui recomendações de stack conflitantes em ADRs legados apenas para a plataforma nova.
