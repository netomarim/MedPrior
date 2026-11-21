# MedPrior

Projeto acadêmico para organizar relatos fictícios de pré-atendimento.

## Executar

Requer Python 3.10 ou superior e internet. Instale as dependências:

    python -m pip install -r requirements.txt

Copie .env.example para .env e informe a URL e a chave pública do Supabase. Nesta máquina, o .env já foi preenchido com a configuração pública do projeto.

Execute iniciar.cmd ou:

    python app.py

Abra http://127.0.0.1:3000 e entre com a conta do Supabase Authentication. O Flask usa a porta definida em PORT no .env, com padrão 3000. O servidor de desenvolvimento atende apenas a máquina local, com debug desativado.

## Arquitetura

- Interface: HTML, CSS e JavaScript.
- Servidor local e API: Python com Flask, em app.py.
- Login e banco: Supabase Auth e PostgreSQL, com acesso limitado por clínica por RLS.
- IA: a interface envia a solicitação ao Flask em POST /api/appointments/<id>/analysis. O Flask encaminha o JWT à Edge Function summarize-appointment, que valida o usuário, consulta o relato sob RLS e chama a OpenRouter.
- A chave OPENROUTER_API_KEY continua nos Secrets do Supabase. Não é necessário copiá-la para o .env.

O Flask gera /config.js em tempo de execução contendo somente a URL e a chave pública. .env e arquivos Python não são servidos como arquivos estáticos. A aplicação não utiliza service_role nem depende de Node.js para executar.

A ficha de IA contém informações identificadas, lacunas, perguntas específicas e uma observação sobre o registro. Não determina diagnósticos, tratamentos ou classificação de risco. Confira o resultado com o relato e o paciente. Só o texto do relato é enviado à OpenRouter; use dados fictícios inclusive dentro do relato.

O conteúdo estruturado continua salvo em appointments.ai_summary. Não foi necessário alterar o banco. Resumos antigos permanecem disponíveis; clique em “Atualizar ficha com IA” para substituí-los pelo novo formato. Falhas preservam o conteúdo anterior. Atualizações concorrentes não são sobrescritas silenciosamente.

Cadastro, listagem, filtros, status e exclusão continuam usando o SDK do Supabase no navegador. A listagem carrega até 500 atendimentos recentes. O indicador “Finalizados hoje” ainda usa a data de criação, uma limitação conhecida desta versão.

## Verificar

    python -m unittest discover -s tests -p test_*.py
    node --test tests/summarize.test.mjs tests/analysis.test.mjs

Python verifica o servidor e sua API. Os testes JavaScript verificam a Edge Function e a apresentação da ficha, com serviços simulados. Node.js só é necessário para executar esses testes. O teste completo com a OpenRouter exige uma sessão autenticada no navegador.

supabase/schema.sql é a proposta inicial; não execute novamente sobre o projeto configurado.
