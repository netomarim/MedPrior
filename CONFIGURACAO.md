# Configuração do MedPrior

## Servidor Python

Instale as dependências com python -m pip install -r requirements.txt.
Execute iniciar.cmd ou python app.py. Abra http://127.0.0.1:3000.

O .env local tem três variáveis:

- SUPABASE_URL: URL do projeto.
- SUPABASE_PUBLISHABLE_KEY: chave pública do projeto, nunca secret ou service_role.
- PORT: porta local, padrão 3000.

O .env já está configurado nesta máquina e está ignorado pelo Git. Para outra máquina, copie .env.example para .env e preencha a chave pública. A senha de login continua sendo digitada somente na interface e validada pelo Supabase Auth.

## IA e chave OpenRouter

A chave já cadastrada permanece em Edge Functions → Secrets no Supabase:
https://supabase.com/dashboard/project/oexmbzplxnmphciosscg/functions/secrets

OPENROUTER_API_KEY é usada somente na função do Supabase. Não copie a chave para o navegador ou para config.js. O Flask encaminha a solicitação autenticada à função, sem ter acesso à chave da OpenRouter.

O modelo padrão é openrouter/free. OPENROUTER_MODEL é uma configuração opcional nos Secrets do Supabase; confira o preço antes de escolher um modelo pago.

## Usar a nova ficha

Entre, crie um atendimento fictício e abra seus detalhes. Clique em “Gerar ficha com IA”. Para um atendimento com resumo antigo, clique em “Atualizar ficha com IA”. A ficha apresenta informações identificadas, lacunas, perguntas e observação sobre o registro.

O resultado precisa ser revisado. Não representa avaliação clínica. O texto do relato é enviado à OpenRouter; não inclua dados reais nele.

O timeout de geração é de 45 segundos na função e até 55 segundos de espera no Flask. Se houver erro, o resumo anterior permanece salvo. Sessão expirada pede novo login; limites e problemas de configuração são informados na interface.
