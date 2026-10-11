# PeopleFlow — avaliação técnica e plano por etapas

**Etapa 0: diagnóstico.** Repositório: `Misael192/Misael192.github.io`. Referência `main` consultada no GitHub; `FETCH_HEAD` e checkout iguais a `8de21c6db752eb2bd4611f757d78aeb4e09f29e9`. Nenhuma mudança de aplicação foi realizada.

## Parecer

Há um MVP funcional de DP que merece aproveitamento, especialmente cadastros, folha, portal e estrutura de serviços. A aplicação ainda não atende ao requisito de SaaS profissional pronto para produção: existem falhas concretas de autorização/isolamento, fluxos demonstrativos apresentados como funcionais, cobertura insuficiente de cenários críticos e operação de produção não comprovada.

O ambiente de desenvolvimento preparado anteriormente funciona. Isso não certifica a segurança ou a prontidão de produção do produto.

As quatro imagens anexadas foram usadas como referências de organização da informação: banco de talentos, listagem de colaboradores, férias e detalhe de férias. Não foram interpretadas como especificações executáveis. A avaliação da interface atual foi feita por código; não houve comparação visual automatizada em navegador ou medição de contraste.

## 1. Arquitetura atual e aderência à stack

Existem duas aplicações independentes:

| Frente | Implementação | Situação |
|---|---|---|
| `mvp/` | PHP puro, MVC próprio, PDO/PostgreSQL, sessão nativa | Principal produto funcional; boa parte do DP e folha está aqui. |
| Raiz | Laravel 12, Eloquent, Sanctum, Redis/Horizon, Livewire/Volt instalado | Fundação de plataforma e algumas APIs; interface predominante em HTML/Tailwind/Alpine. |

A mudança de TypeScript para PHP foi deliberada e documentada em `docs/adr/ADR-009-migracao-laravel.md`. Sua nova exigência de Next/Nest/Prisma implica revisar essa decisão, migrar a plataforma e validar equivalência dos fluxos; instalar pacotes Node não resolveria a divergência.

| Requisito | Evidência atual |
|---|---|
| Next.js 15, React, TypeScript | Não implementados na aplicação atual. |
| Shadcn, Framer Motion, React Hook Form, Zod, TanStack Query | Não presentes na implementação inspecionada. |
| Tailwind | Presente; telas usam também o compilador no navegador. |
| NestJS, Node backend, Prisma | Não implementados; backend PHP e migrations SQL/Eloquent. |
| PostgreSQL e Redis | Disponíveis; Laravel usa SQLite no fluxo local/testes. RLS PostgreSQL não foi validada nesta auditoria. |
| JWT | Sanctum emite tokens opacos; não é JWT. Refresh rotativo próprio existe. |
| RBAC | Implementado em partes, com lacunas de autorização por objeto/empresa. |
| 2FA | Verificação TOTP no login Laravel; não há fluxo completo de ativação, recuperação e gestão. Não implementado no login demonstrativo HTML. |
| S3/Supabase | Configuração S3 no Laravel; MVP armazena arquivos localmente. Integração ponta a ponta não comprovada. |
| Vercel/Railway/Docker | Não há pacote de implantação completo comprovado. README cita `docker/` e compose, ausentes no checkout. |

**Pontos positivos:** serviços de domínio separados em partes; dinheiro representado em centavos; hashing Argon2id; prepared statements; CSRF no MVP; permissões; refresh com detecção de reuso; migrations com índices e RLS; componentes PHP compartilhados; registros de auditoria. Clean Architecture/SOLID são parcialmente aplicados, não uma garantia sobre toda a aplicação.

## 2. Estrutura de pastas

Estrutura atual relevante:

```text
app/                   # Laravel: Core, Models, Services, Controllers
database/migrations/   # Schema Laravel
routes/api.php         # APIs Laravel limitadas
public/*.html          # Demonstração da plataforma
tests/                 # Suíte Laravel
mvp/app/               # MVC, serviços e views do produto funcional
mvp/database/          # schema + seeds + fases 2–6
mvp/public/            # Endpoints PHP do MVP
mvp/tests/             # Testes de calculadoras
docs/                  # Arquitetura, roadmap e ADRs
```

Estrutura proposta para a próxima etapa, ainda não implementada:

```text
apps/web/                 # Next.js 15, React, TypeScript
apps/api/                 # NestJS, controllers e composição
apps/worker/              # Jobs, webhooks, documentos, integrações
packages/domain/          # Entidades, regras e portas sem dependência web/ORM
packages/application/     # Casos de uso e autorização
packages/database/        # Prisma, migrations SQL/RLS, repositories
packages/contracts/       # Contratos de API e validações compartilháveis
packages/ui/              # Componentes Shadcn e tokens PeopleFlow
packages/config/          # Configuração TS, lint e ferramentas
tests/integration/        # PostgreSQL/Redis e autorização
tests/e2e/                # Fluxos reais de usuário
infra/                    # Docker, operação e procedimentos
docs/                     # ADRs, API, segurança e implantação
```

Recomendação: monólito modular inicialmente. Separar workers por necessidade operacional; extrair serviços apenas quando volume e responsabilidades justificarem.

## 3. Banco de dados

O schema atual é SQL/Eloquent, não Prisma. Há boa cobertura de entidades, mas tabela ou model não equivale a módulo entregue.

O domínio precisa distinguir **tenant** (cliente do SaaS) de **empresa/filial** dentro desse cliente. A autorização deve considerar tenant, empresa, papel e vínculo do funcionário/gestor.

Para a nova fundação:

- Prisma com `Tenant`, `Company`, `Branch`, `Department`, `Position`, `User`, `Membership`, `Role`, `Permission`, `Employee`, `Session`, `MfaCredential`, `AuditEvent` e entidades de DP/RH adicionadas conforme cada etapa.
- `tenant_id` obrigatório nas entidades privadas; chave única composta e FKs compostas para impedir referências entre tenants. Mesma disciplina para vínculos de empresa quando aplicável.
- PostgreSQL RLS habilitada e testada com usuário da aplicação sem privilégios de superusuário/BYPASSRLS. Contexto por transação, inclusive em workers, sem depender de uma conexão persistente anterior.
- Índices derivados das consultas: tenant/empresa/status, funcionário/competência, tenant/data, unicidade de matrícula e identidade por escopo. Medir planos e paginar consultas reais.
- Constraints e transações para saldo de férias, fechamento de folha, decisão única e liquidação do banco de horas.
- Migração ensaiada com reconciliação de contagens, vínculos, saldos, valores e documentos; rollback e backups restaurados em teste.
- Dados sensíveis com minimização, criptografia adequada, retenção definida e trilhas sem copiar payloads pessoais completos indiscriminadamente.

## 4. APIs e autorização

Laravel tem rotas de health, login/refresh/logout, colaboradores, solicitação/aprovação de férias e chat (`routes/api.php`). MVP tem API pública com chaves, escopos, colaboradores, folhas, férias e eventos. A documentação cita `docs/openapi.yaml`, mas esse arquivo está ausente; não há contrato único validado das duas frentes.

Na próxima etapa, propor endpoints de autenticação, MFA, contexto de empresa, usuários/permissões, colaboradores e férias. Versionar em `/api/v1`, definir paginação/erros/idempotência e gerar OpenAPI a partir da implementação. Não anunciar essas APIs como implementadas antes da entrega.

Aplicar autorização no caso de uso e por objeto; proteger portal pessoal e ações de gestor. Um UUID válido, uma permissão genérica ou `exists:id` não prova que o usuário pode operar aquele funcionário.

## 5. Interfaces e matriz de funcionalidades

| Módulo solicitado | Estado encontrado | Limites principais |
|---|---|---|
| Dashboard | Parcial/funcional no MVP | KPIs e pendências; parte das consultas é global. BI, turnover/absenteísmo completos não comprovados. |
| Empresas, usuários, colaboradores | Funcional no MVP | Falhas de isolamento em empresas/usuários/dashboard; falta paginação e validação consistente de vínculos. |
| Admissão, contratos, GED | Parcial/funcional | Checklist, arquivos/versionamento/evidências; sem processo completo de admissão externa e assinatura avançada integrado. |
| Folha, holerites, 13º, rescisão | Funcional com limites | Calculadoras e recibos; validação normativa, jornadas, regras coletivas e conciliação pendentes. |
| Ponto, escalas, banco de horas, férias | Funcional com limites | Autorização por vínculo, saldo transacional e integração folha/banco exigem revisão. |
| Afastamentos, advertências, suspensões, saúde/EPI | Parcial ou sem fluxo completo comprovado | Existência de schema/campos não demonstra módulo operacional. |
| Recrutamento, currículos, vagas, Kanban | Principalmente UI/schema | Pipeline visual na raiz; backend completo não comprovado. |
| Desempenho, carreira, clima, treinamento, comunicação | Principalmente schema/UI | Ausência de fluxos completos e testes correspondentes. |
| Benefícios | Parcial/funcional no MVP | Atribuição e desconto; demais integrações não comprovadas. |
| Portal do funcionário | Parcial/funcional no MVP | Ponto, recibos, férias e documentos próprios; não cobre todas as solicitações, perfil, senha e treinamentos exigidos. |
| Portal do gestor | Parcial | Aprovações em alguns endpoints; página HTML raiz simula ações. |
| IA | Parcial | Assistente MVP determinístico; drivers Laravel preparados, sem todas as capacidades pedidas validadas. |
| Planos, assinatura, PIX/cartão/boleto, nota fiscal | Principalmente schema | Sem ciclo completo de cobrança, webhooks e emissão fiscal comprovado. |
| Administração, notificações, backup | Parcial | Papéis/auditoria/configuração básica; operação, restauração e funcionalidades completas pendentes. |
| eSocial | Geração simplificada | XML S-2200/S-1200; não houve validação oficial XSD/homologação/transmissão. |
| API pública/webhooks | Parcial/funcional no MVP | Autorizações e proteção de destinos precisam revisão; conectores prontos não entregues. |
| PWA, biometria/geolocalização, plugins | Não comprovados | Não tratar esses diferenciais como entregues. |

### UX observada

- A raiz tem identidade PeopleFlow, fontes locais, tokens, tema persistido, foco visível e suporte a movimento reduzido. Aproveitar esses ativos e padrões de informação, sem copiar marca ou layout do concorrente.
- `public/login.html:70` só redireciona; `public/gestor.html:167` só remove cards. Outras ações exibem sucesso sem API. Precisam ser substituídas por fluxos persistidos.
- `public/configuracoes.html:166` inicia MFA visualmente ativo, com switch local. Remover afirmações não sustentadas ou ligar a estados reais do backend.
- `mvp/app/views/layout/app_start.php:29` esconde a navegação abaixo de `lg` sem oferecer menu móvel correspondente. Correção prioritária de usabilidade.
- `mvp/app/models/Employee.php:21` carrega toda a lista; busca atual é no DOM. Usar busca/filtro/paginação no servidor.
- Formulário extenso perde dados ao erro/redirecionamento (`EmployeeController.php:171`); preservar preenchimento e associar erros aos campos.
- Links da sidebar recolhida perdem nome acessível; drawer carece de gestão de foco/Escape. Testar por teclado/leitor de tela, em 320/768/1440 px.

## 6. Componentes propostos

Shell com navegação por permissões e seletor de empresa; tabela paginada; filtros; formulário com React Hook Form/Zod; diálogo de aprovação; upload com estado de processamento; calendário; painel de pendências; componentes de autenticação/MFA; estados vazio, carregando e erro.

Shadcn deve servir de base acessível, com tokens PeopleFlow próprios. TanStack Query controla estado remoto; sucesso visual depende de confirmação persistida. Framer Motion respeita movimento reduzido. Definir contraste e testes reais de responsividade antes de afirmar acessibilidade.

## 7. Achados de código que bloqueiam produção

Prioridades abaixo são de correção; as evidências são específicas ao commit avaliado.

| Prioridade | Achado | Evidência e efeito |
|---|---|---|
| P0 | Gestão de usuários fora da empresa no MVP | `mvp/app/controllers/UserController.php:39`, `:61`, `:77`, `:88`; `mvp/app/models/User.php:24`, `:53`. Consulta global; alteração por ID sem escopo; criação aceita company_id enviado. GET exige apenas login. |
| P0 | Dashboard/empresas com dados globais | `mvp/app/controllers/DashboardController.php:22`; models Company/Employee com consultas globais. Mistura dados de empresas. |
| P1 | Usuário desativado renova sessão Laravel | `app/Services/Auth/RefreshTokenService.php:47`; `AuthController.php:58`. Reproduzido: refresh retorna 200 após `is_active=false`. |
| P1 | Sessões MVP mantêm permissões antigas | `mvp/app/services/AuthService.php:41`; `mvp/app/middleware/Auth.php:12`. Desativação/rebaixamento no banco não invalida a sessão já aberta. Achado por código. |
| P1 | Conversa de IA sem verificação do proprietário | `app/Core/AI/AiEngine.php:31`. UUID de conversa do mesmo tenant é aceito sem filtrar user_id; histórico alheio pode entrar no contexto do provedor. Exige ID conhecido, módulo e provedor utilizáveis; não foi feito envio externo. |
| P1 | Logout revoga refresh de outro usuário | `RefreshTokenService.php:81`; `AuthController.php:74`. Usa apenas ID, ignora segredo e proprietário. Reproduzido dentro do mesmo tenant com ID conhecido e segredo inválido. Não implica adivinhar UUIDs. |
| P1 | Portal pode solicitar férias de colega | `app/Http/Controllers/Api/V1/VacationController.php:25`. Reproduzido: usuário EMPLOYEE sem vínculo com alvo recebe 201. |
| P1 | Escopo tenant falha aberto na aplicação | `app/Core/Tenancy/BelongsToTenant.php:21`. Sem contexto, filtro desaparece. Reproduzido em SQLite; não constitui teste de bypass da RLS PostgreSQL. |
| P1 | Workers sem contexto e workflows duplicados | `app/Events/DomainEvent.php:23`, `app/Listeners/StartWorkflowsForDomainEvent.php:22`, `WorkflowEngine.php:44`. Mesmo evento 2x gera 2 instâncias; sem tenant, leitura ocorre e criação falha em SQLite. Falta transportar/restaurar contexto e deduplicar. |
| P1 | Referências de funcionário não vinculadas à empresa | `mvp/app/models/Vacation.php:39`; `TimeClock.php:30`. Operações recebem company_id e employee_id sem comprovar que pertencem ao mesmo escopo. FKs simples não suprem essa regra. |
| P1 | Saldo de férias não é revalidado na decisão | `mvp/app/models/Vacation.php:39`, `:60`. Várias solicitações podem usar o mesmo saldo inicial; aprovação bloqueia a solicitação, não o período/saldo. Laravel também não oferece regras completas de saldo. |
| P1 | Destinos de webhook sem proteção SSRF | `mvp/app/services/Api/WebhookService.php:89`; cadastro aceita URL sem bloquear redes privadas. Requisições diretas podem atingir serviços internos. Achado por código; nenhuma exploração de rede privada foi executada. |
| P1 | Banco positivo convertido automaticamente em HE | `mvp/app/services/Payroll/PayrollService.php:102`. Importa créditos positivos como hora extra 50%; falta decisão/liquidação correspondente do banco. Revisar compensação e pagamento para evitar dupla utilização. |
| P1 | Folha com tabelas antigas e jornada fixa | `mvp/database/fase3.sql:196`; `PayrollEngine.php:20`, `:147`. Fixtures fiscais de 2025, divisor 220 fixo. Exigir revisão normativa vigente e parametrização; testes atuais não certificam CLT/tributação 2026. |

Não foram explorados serviços de terceiros ou dados reais. Os testes adicionais usam dados sintéticos e SQLite em memória.

Correções devem incluir testes que esperem **negação**, não apenas os exemplos atuais que demonstram aceitação indevida. Revogação precisa cobrir access e refresh; serializar rotação para lidar com concorrência. Jobs precisam de tenant e event_id, outbox transacional e consumidores idempotentes.

## 8. Testes e evidências

Executados nesta avaliação:

- `php artisan test`: **11 testes, 34 asserções passaram**. Banco SQLite em memória conforme `phpunit.xml`.
- `php mvp/tests/payroll_tests.php`: **37 verificações passaram**; calculadoras, sem banco e com fixtures de 2025.
- `npm run build`: **passou**, Vite 7.3.7. Não é build Next.js nem teste das operações HTML.
- Auditoria adicional: **4 testes/6 asserções reproduziram comportamentos inseguros**. O resultado “OK” significa que os bugs foram reproduzidos, não que a proteção passou.
- Auditoria dos models MVP: **4 comportamentos reproduzidos** com fixtures sintéticas SQLite: listagem global, alteração de perfil em outra empresa, criação de usuário em outra empresa e férias com vínculo entre empresas. São provas em nível de model, não um teste HTTP completo nem validação PostgreSQL.
- Auditoria de workflow: **2 instâncias** para a mesma entrega repetida; sem contexto tenant a criação falha e consulta retorna template em SQLite.
- Git limpo antes/depois; alterações apenas em artefatos locais/gerados.

Evidências reutilizáveis fora do checkout: `PeopleFlowSecurityAuditTest.php`, `peopleflow-mvp-security-audit.php` e `peopleflow-workflow-audit.php`, nesta pasta.

Reprodução no ambiente preparado, a partir de `/workspace/Misael192.github.io`:

```bash
/workspace/cloud-tools/bin/php artisan test --no-ansi
/workspace/cloud-tools/bin/php mvp/tests/payroll_tests.php
npm run build
/workspace/cloud-tools/bin/php vendor/bin/phpunit /workspace/reports/PeopleFlowSecurityAuditTest.php --colors=never
/workspace/cloud-tools/bin/php /workspace/reports/peopleflow-mvp-security-audit.php
/workspace/cloud-tools/bin/php /workspace/reports/peopleflow-workflow-audit.php
```

Faltam provas de isolamento usando PostgreSQL e role de produção, concorrência em refresh/férias/folha, autorização cruzada em todos os objetos, recuperação de conta/MFA, uploads, contratos de integrações, e2e persistido, carga e restauração de backup. A auditoria não mediu percentual de cobertura.

## 9. Documentação e plano de entrega

README, roadmap e ADRs estão presentes, mas o estado descrito é mais amplo do que a implementação. `docs/ARCHITECTURE.md` ainda descreve a arquitetura TypeScript; ADR-009 escolhe PHP; README menciona arquivos de infraestrutura/API ausentes. Atualizar documentação conforme a implementação entregue, com status “funcional”, “parcial” ou “planejado”.

Proposta de etapas, cada uma com arquitetura, pastas, banco/migrations, APIs, interfaces, componentes, código, testes, documentação e guia de implantação, quando aplicáveis:

1. **Fundação na stack obrigatória:** monorepo Next15/Nest/Prisma, PostgreSQL/Redis, isolamento tenant/empresa, JWT/refresh/MFA, RBAC/ABAC, auditoria, shell acessível e fluxo vertical de colaboradores. Critério: dois tenants não acessam dados um do outro; MFA/rotação/revogação/concorrência testadas; build e staging reproduzíveis.
2. **DP operacional:** organização, admissão, documentos e armazenamento privado, contratos, férias e aprovações. Critério: saldos e vínculos transacionais; permissão por funcionário/gestor; evidências e downloads autorizados.
3. **Ponto e folha:** jornadas/compensação, eventos, cálculos, holerites e desligamento. Critério: parâmetros normativos revisados, equivalência de cálculos úteis do MVP, fechamento/liquidação idempotentes e reconciliação.
4. **RH e portais:** recrutamento/ATS, avaliações, benefícios, clima, carreira, treinamento e comunicação, com portais do funcionário/gestor. Pode ser subdividida em entregas menores aprovadas individualmente.
5. **IA e integrações:** provedores, documentos com aprovação humana, dados com autorização, eSocial homologado, APIs públicas e webhooks protegidos.
6. **Comercial e operação:** assinatura/cobrança, gateways, notas fiscais, notificações, backups restauráveis, observabilidade, desempenho e PWA. Critério de lançamento inclui teste de recuperação e verificação final de segurança.

Reaproveitar regras de negócio, cenários de teste, conceitos do schema e identidade visual. Reescrever adaptadores/controladores/interfaces para a stack escolhida. Congelar o legado durante migração; ensaiar transformação dos dados e desativá-lo apenas após reconciliação. Não manter indefinidamente duas aplicações com permissões e bancos diferentes.

Nenhuma próxima etapa foi iniciada. A ordem pode ser ajustada após sua aprovação da fundação e do escopo.

## 10. Guia de implantação e condições de lançamento

O setup atual é de desenvolvimento: ferramentas em `/workspace/cloud-tools`, bancos locais e instruções salvas no onboarding. Não usar o cluster local com autenticação trust como configuração de produção.

Para a nova stack, a entrega de implantação deve incluir:

1. Frontend Next.js na Vercel; API/worker NestJS em Railway ou imagens Docker. Separar staging e produção.
2. PostgreSQL e Redis gerenciados, acesso restrito e TLS; usuário de migrations separado do runtime; aplicação sem bypass de RLS.
3. Migrations versionadas executadas como release controlado, compatibilidade entre versões e plano de rollback de aplicação/dados.
4. Bucket privado S3/Supabase, downloads assinados após autorização, política de tamanho/tipo, análise de arquivos e ciclo de retenção.
5. Segredos em settings/vault, chaves rotacionáveis, debug desligado, cookies seguros, CORS/CSRF coerentes com topologia de autenticação, Helmet/rate limits e configuração de proxy.
6. Jobs com retry limitado, idempotência, fila de falhas, contexto tenant explícito e monitoração. Health/readiness deve abranger dependências críticas.
7. Backup/PITR com teste de restauração, metas de recuperação, logs estruturados com redaction, métricas e alertas.
8. Smoke tests pós-release, testes de isolamento com role real, reconciliação e aprovação de lançamento. Não basta haver PID, porta aberta ou uma suite pequena verde.

Esta etapa entrega diagnóstico e planejamento. Não entrega nem certifica um novo sistema de produção; a implementação será feita progressivamente após aprovação.
