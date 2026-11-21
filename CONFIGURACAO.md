# Configuração do MedPrior

## Ambiente local

Instale Python 3.10 ou superior. Na pasta do projeto:

```powershell
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Copie o modelo somente se ainda não houver `.env`; preserve os valores de um ambiente existente. Configure:

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do projeto Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública publishable do mesmo projeto. |
| `PORT` | Porta local; padrão `3000`. |

O `.env` é ignorado pelo Git. Não use uma secret key ou `service_role` no campo da chave pública.

Para iniciar sempre que quiser:

```powershell
python app.py
```

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000), mantenha o terminal aberto e encerre com **Ctrl+C**. `iniciar.cmd` executa o mesmo servidor. Se configurar outra porta, ajuste o endereço no navegador.

## Supabase e OpenRouter

O projeto Supabase usado pela demonstração já está configurado. Consulte [supabase/README.md](supabase/README.md) antes de executar SQL ou tentar reproduzir o banco em outro projeto.

A função `summarize-appointment` exige JWT de usuário. No painel do projeto, em **Edge Functions > Secrets**, configure `OPENROUTER_API_KEY`. A chave permanece no servidor do Supabase e não precisa ser copiada para o `.env` local.

`OPENROUTER_MODEL` é opcional e substitui o modelo padrão `openrouter/free`; confira o preço antes de selecionar um modelo pago. A geração inicial faz até duas tentativas de 18 segundos cada para falhas temporárias, timeout ou saída inválida. Erros de chave, créditos e limite de uso não são repetidos. O Flask aguarda até 55 segundos pela resposta, além do limite de conexão. O roteador gratuito continua sujeito à disponibilidade dos provedores; o aplicativo não muda automaticamente para modelos pagos.

O pedido desativa raciocínio adicional quando o provedor permite, para reduzir latência e respostas truncadas. O JSON continua sendo validado antes de salvar; uma falha preserva os dados anteriores. Os logs `analysis_provider` contêm apenas número da tentativa, código e categoria do erro, sem relatos ou credenciais.

A função inicial organiza o relato e sugere perguntas. Depois de registrar a única rodada de respostas, o banco gera a ficha final sem chamar a OpenRouter novamente. A exportação em PDF também funciona sem conexão com a OpenRouter.

## Contas e primeiro acesso

Use o e-mail e a senha da conta cadastrada no Supabase Auth. A senha não fica no `.env`.

- Uma conta nova usa **Criar meu acesso** e confirma o e-mail.
- O superadministrador cadastra a clínica e vincula seu administrador pelo e-mail confirmado.
- Em **Equipe e acessos**, o administrador vincula os atendentes que já possuem contas confirmadas.
- Sem vínculo com uma clínica ativa, a conta não acessa atendimentos.
- O papel de superadministrador é concedido pelo operador do banco, fora da interface pública; não é obtido pelo cadastro de conta.

Se um vínculo for alterado com a pessoa já conectada, ela deve clicar em **Atualizar acesso**. Se a sessão expirar, entre novamente.

A confirmação de e-mail depende da configuração de envio do Supabase. Para um novo projeto, confira esse envio e os endereços de redirecionamento do Auth; o aplicativo não configura esses serviços automaticamente.

## Recuperar senha

Na tela de entrada, use **Esqueci minha senha**, informe o e-mail e abra o link recebido com o servidor Python em execução. O aplicativo apresenta os campos de nova senha e confirmação (mínimo de 12 caracteres) e volta ao login após salvar. Links inválidos ou expirados orientam a solicitar outro. O ícone de olho no login alterna a visibilidade da senha.

No painel do Supabase, em **Authentication > URL Configuration > Redirect URLs**, autorize os endereços usados pelos colegas:

```text
http://127.0.0.1:3000/?recovery=1
http://localhost:3000/?recovery=1
```

Se usar outra porta, cadastre também o endereço correspondente. O link usa o endereço em que a pessoa pediu a recuperação e deve ser aberto no computador com o servidor em execução. Confira o envio de e-mail/SMTP e seus limites no Supabase; o aplicativo não altera essas configurações. A mensagem de solicitação não informa se o e-mail possui conta.

## Atualizar o projeto

Após obter uma nova versão:

1. Preserve o `.env`.
2. Execute `python -m pip install -r requirements.txt`.
3. Encerre o servidor antigo com **Ctrl+C** e execute `python app.py`.
4. Recarregue o navegador com **Ctrl+F5**.

Para respostas antigas já salvas cuja ficha ainda não foi consolidada, abra o atendimento e use **Consolidar respostas salvas**. Não é necessário preencher uma nova rodada.

## Problemas comuns

| Situação | Verificação |
| --- | --- |
| Porta ocupada | Encerre a outra execução ou altere `PORT` e reinicie. |
| Configuração inválida | Confira a URL e a chave pública do mesmo projeto no `.env`; reinicie o Flask. |
| Verificação de sessão falha | Recarregue com Ctrl+F5 e confira a conexão; a biblioteca do Supabase é carregada por CDN. |
| Conta sem clínica ativa | Solicite o vínculo e use **Atualizar acesso**. |
| E-mail ainda não confirmado | Conclua a confirmação enviada pelo Supabase antes do vínculo. |
| IA indisponível ou com limite | Preserve o relato salvo e tente a geração inicial mais tarde. |
| Atendimento mudou | Atualize a lista e abra os detalhes antes de repetir a alteração. |
| PDF não encontrado após atualizar | Reinicie `python app.py` e confira as dependências. |

A prioridade é a transcrição de uma avaliação profissional. Informe a identificação de quem classificou; **Não classificado** não significa **Não urgente**. O sistema não faz classificação clínica automática.
