# Banco e Edge Function

## Estado do ambiente

O projeto Supabase da demonstração foi provisionado durante o desenvolvimento e já recebeu as alterações de clínicas, equipe, respostas, prioridade e indicadores. As credenciais locais ficam no `.env`; o segredo da OpenRouter fica nos Secrets do projeto.

Os arquivos abaixo registram a evolução do ambiente existente. **Não são um instalador idempotente para um projeto novo.** Não os execute novamente em lote sobre um banco configurado.

| Arquivo | Conteúdo |
| --- | --- |
| `schema.sql` | Proposta inicial de tabelas e políticas. Os nomes das políticas do ambiente provisionado podem diferir desse rascunho. |
| `saas_workflow.sql` | Papéis de plataforma, clínicas ativas, equipe, respostas e ciclo do atendimento. |
| `workflow_statistics.sql` | Indicadores com horários de início e finalização. |
| `workflow_hardening.sql` | Revisão intermediária de funções, validações e índices. |
| `single_round_and_priority.sql` | Versão posterior que consolida uma única rodada e registra a prioridade informada por profissional. |

Para outro projeto Supabase, revise e adapte a sequência de migrações, incluindo os nomes das políticas e gatilhos, antes de aplicar. O `schema.sql` isolado não representa a versão atual completa. Não reaplique a revisão intermediária sobre a versão posterior, pois isso restauraria o comportamento antigo de respostas.

## Permissões

- `private.platform_admins` guarda os superadministradores e não permite promoção por usuários da aplicação.
- Funções privilegiadas ficam no esquema privado, verificam o usuário e são acessadas por funções públicas com permissões restritas.
- RLS limita atendimentos e respostas aos vínculos com clínicas ativas.
- Administrar a plataforma não concede acesso operacional automático a todas as clínicas.
- O primeiro superadministrador precisa ser atribuído pelo operador autorizado do banco a uma conta confirmada. Esse bootstrap não é executado pela interface nem contém uma conta real fixa nos scripts do repositório.

## Publicar a função de IA

A fonte está em `functions/summarize-appointment/`. O arquivo `config.toml` mantém `verify_jwt = true`. Publique o diretório completo pelo fluxo de implantação do Supabase e configure `OPENROUTER_API_KEY` em **Edge Functions > Secrets**.

A função usa o JWT para validar o usuário e consultar o atendimento com RLS. Na fase inicial, envia apenas o relato à OpenRouter. Se já houver respostas, utiliza a consolidação do banco e não gera uma nova rodada.

## Formato das fichas

- Versão 2: organização inicial gerada por IA, com fatos relatados, lacunas e perguntas.
- Versão 3: ficha final consolidada a partir do relato e das respostas salvas, sem nova interpretação por IA.

O texto estruturado é salvo em `appointments.ai_summary`. As respostas originais permanecem em `appointment_answers`, com autor e horário. A prioridade é separada da ficha e mantém profissional informado, conta que registrou e horário.

O teste `../tests/database_workflow.sql` cria dados fictícios dentro de uma transação e os reverte ao concluir. Ele não deve ser usado como carga de dados ou migração de produção.
