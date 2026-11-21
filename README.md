# MedPrior

Projeto acadêmico para organizar relatos de pré-atendimento de uma clínica. Use apenas pacientes fictícios.

## Executar

Requer Node.js e internet. Dê dois cliques em `iniciar.cmd` e abra http://127.0.0.1:3000. Alternativamente, execute `node server.cjs` nesta pasta. Não é necessário instalar pacotes.

Entre com o e-mail e a senha do usuário criado no Supabase Authentication. A senha é enviada apenas ao Supabase Auth. A biblioteca oficial gerencia a sessão e a renovação de tokens no navegador. Sair encerra a sessão local e limpa os dados exibidos.

## Implementado

- Login, restauração da sessão e logout com Supabase Auth.
- Clínica obtida a partir do vínculo do usuário autenticado.
- Cadastro, listagem, pesquisa, filtros, alteração de status e exclusão no Postgres.
- Acesso aos registros limitado por clínica pelas políticas RLS do banco.
- Mensagens de falha sem mostrar uma gravação como concluída antes da confirmação do banco.

A interface usa HTML, CSS e JavaScript. Supabase JS 2.49.8 é carregado via CDN jsDelivr com versão fixa. `config.js` contém apenas URL e chave publishable públicas. Não há secret key ou service_role no cliente.

## Situação atual

O Supabase MedPrior já está configurado. O usuário da demonstração está vinculado à Clínica Vida Plena como owner. `supabase/schema.sql` registra a proposta inicial e não deve ser executado novamente no banco configurado. As tabelas, políticas e o gatilho de atualização foram criados pelo SQL Editor.

A interface carrega até 500 atendimentos recentes. Registros da antiga demonstração no localStorage não são importados automaticamente. A IA ainda não está conectada: o detalhe mostra essa indisponibilidade. A próxima entrega será uma Edge Function autenticada que consulte o atendimento sob RLS e chame a OpenRouter com uma chave guardada como segredo no servidor.

## Verificação

O ciclo de cadastrar, consultar, mudar status e excluir foi validado sob o papel authenticated com o usuário de demonstração, dentro de uma transação revertida. Uma conta sem vínculo foi impedida de consultar dados e inserir atendimentos. A sintaxe dos arquivos JavaScript foi conferida. O login com a senha real deve ser feito pelo usuário no navegador.

## Entrega

Integrantes: preencher antes da entrega. GitHub, PDF e demonstração da IA serão preparados nas etapas finais.
