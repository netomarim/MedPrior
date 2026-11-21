# MedPrior

Sistema acadêmico de pré-atendimento para clínicas, com organização de relatos por IA, entrevista assistida e exportação em PDF. Use somente pacientes e informações fictícias.

## Iniciar o projeto

Requisitos: Python 3.10 ou superior, internet e um projeto Supabase configurado. Node.js é usado somente nos testes JavaScript.

```powershell
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Preencha no `.env` a URL e a chave **publishable** do Supabase. Se o arquivo já existir, preserve sua configuração.

```powershell
python app.py
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). Encerre com **Ctrl+C**. O arquivo `iniciar.cmd` é um atalho opcional. Após atualizar o código Python ou as dependências, reinicie o servidor; para atualizar a interface, use **Ctrl+F5**.

O Flask atende somente a máquina local, com debug desativado. A variável `PORT` permite trocar a porta, cujo padrão é `3000`.

Consulte [CONFIGURACAO.md](CONFIGURACAO.md) para detalhes de ambiente e solução de problemas e [supabase/README.md](supabase/README.md) para o estado do banco e da função de IA.

## Como funciona

1. Um integrante da equipe entra com sua conta e seleciona uma clínica ativa à qual está vinculado.
2. O atendente registra o relato informado pelo paciente ou acompanhante, ou uma observação da equipe. Pacientes não precisam de conta.
3. **Gerar perguntas com IA** organiza as informações e propõe até quatro perguntas para complementar o relato. Se a IA não indicar perguntas, o registro pode seguir sem entrevista complementar.
4. O atendente responde à única rodada, usando **Não informado** quando necessário, e clica em **Salvar respostas e atualizar ficha**.
5. O banco salva as respostas e monta a ficha final na mesma transação. Essa consolidação transcreve o relato e as respostas; não faz outra chamada nem uma nova interpretação por IA. Não são abertas novas rodadas.
6. O atendimento segue de **Aguardando** para **Em atendimento** e depois **Finalizado**. Após finalizar, permanece disponível para consulta e PDF.

Atendimentos antigos com respostas já salvas e ficha desatualizada podem usar **Consolidar respostas salvas**. O relato original, a autoria e os horários das respostas são preservados.

A fila da visão geral mostra os cinco atendimentos abertos mais antigos, por ordem de chegada. A listagem completa inclui finalizados e carrega 500 registros por vez com **Carregar mais atendimentos**. Pesquisa e filtros atuam sobre os registros carregados; a interface informa quando existem registros anteriores ainda não carregados.

Os indicadores usam o horário real de início e finalização, com o dia de referência de Brasília. Registros antigos sem esses horários não recebem datas inventadas.

## Perfis e clínicas

| Perfil | Acesso |
| --- | --- |
| Superadministrador | Cadastra, ativa e desativa clínicas e define seus administradores. |
| Administrador da clínica | Gerencia atendentes e opera os registros da clínica vinculada. |
| Atendente / equipe | Registra relatos, respostas, prioridade informada e status na clínica vinculada. |
| Paciente | Informa sintomas e responde ao atendente; não possui acesso próprio nesta versão. |

Novos integrantes usam **Criar meu acesso**, confirmam seu e-mail e aguardam vínculo por um administrador. Criar uma conta não libera acesso a clínicas. Ao cadastrar uma clínica, o superadministrador informa o e-mail já confirmado de seu administrador.

O superadministrador não recebe acesso automático aos relatos de todas as clínicas: a operação clínica exige um vínculo. O último administrador de uma clínica não pode ser removido. Desativar a clínica suspende o acesso aos atendimentos, preservando os registros. Somente administradores com vínculo operacional podem excluir atendimentos fictícios.

## Prioridade do atendimento

O valor inicial é **Não classificado**. A equipe pode transcrever uma classificação feita por profissional habilitado, conforme o protocolo da clínica: **Não urgente**, **Pouco urgente**, **Urgente**, **Muito urgente** ou **Emergência**.

O registro exige a identificação do profissional responsável e guarda a conta que transcreveu a classificação e o horário. A prioridade aparece na lista, nos detalhes e no PDF. O sistema não valida credenciais profissionais, não executa um protocolo de triagem e não atribui urgência automaticamente por IA. **Não classificado** não equivale a ausência de urgência.

## PDF para revisão médica

Nos detalhes, use **Baixar PDF para revisão médica**. O documento A4 contém clínica, paciente, idade quando informada, situação, prioridade registrada, datas, relato original, perguntas e respostas salvas e a ficha disponível.

Relatos fornecidos, perguntas da IA e consolidação automática são identificados. Fichas antigas desatualizadas recebem aviso. É possível exportar sem gerar IA. Salve as alterações digitadas antes de baixar.

O Flask consulta os dados salvos usando a sessão do usuário e gera o PDF em memória. O arquivo é baixado pelo navegador; não é armazenado no servidor nem enviado automaticamente ao médico. O documento é uma ficha de pré-atendimento, não um diagnóstico, prescrição ou prontuário médico completo.

## Arquitetura e configuração

| Componente | Responsabilidade |
| --- | --- |
| HTML, CSS e JavaScript | Interface, formulários e interação com o SDK do Supabase. |
| Python / Flask (`app.py`) | Serve a interface, gera a configuração pública, encaminha a chamada de IA e disponibiliza o PDF autenticado. |
| Supabase Auth | Login, confirmação de e-mail e sessões. |
| PostgreSQL / RLS | Dados, vínculos, autorização por clínica, consolidação das respostas e ciclo do atendimento. |
| Edge Function `summarize-appointment` | Valida a sessão e o acesso ao atendimento antes de chamar a OpenRouter na etapa inicial. |
| ReportLab (`reports.py`) | Gera os documentos PDF. |

Cadastro, consulta e alterações dos atendimentos usam o SDK do Supabase no navegador. As políticas do banco são aplicadas a cada operação. Consultas de detalhes leem o atendimento e suas respostas juntos; alterações de status, prioridade e exclusões comparam a versão lida para detectar mudanças concorrentes.

A chave `OPENROUTER_API_KEY` fica nos Secrets do Supabase. O modelo padrão é `openrouter/free`, sujeito à disponibilidade e aos limites do serviço. Apenas o relato é enviado na geração inicial; a consolidação posterior ocorre no banco, sem novo envio à OpenRouter.

`/config.js` é gerado pelo Flask e contém somente a URL e a chave pública. O `.env`, chaves secretas e arquivos Python não são servidos como arquivos estáticos. Não há dependência de `service_role` na aplicação.

## Testes

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p test_*.py
```

Os testes locais verificam inicialização usando o HTML real, restauração de sessão, isolamento de estado, fila, conflitos de atualização, apresentação das fichas, tratamento de erros, API Flask e PDF. Chamadas externas são simuladas nesses testes. A extração textual opcional do PDF depende de `pdftotext` e pode ser ignorada quando a ferramenta não estiver instalada.

[tests/database_workflow.sql](tests/database_workflow.sql) verifica os perfis, isolamento entre clínicas, entrevistas, prioridade e ciclo dos atendimentos em uma transação revertida. Use somente em um ambiente de desenvolvimento sob controle do operador do banco.

A validação completa com a OpenRouter exige uma conta autenticada, a função publicada e o segredo configurado. Os testes automatizados locais não substituem essa verificação.
