# Configuração atual do MedPrior

O projeto Supabase já está criado, as três tabelas estão com RLS e o usuário da demonstração já foi associado à clínica. A URL e a chave publishable estão em `config.js`.

Para iniciar, dê dois cliques em `iniciar.cmd`, mantenha o terminal aberto e acesse http://127.0.0.1:3000. Use o e-mail e a senha definidos em Authentication. Nunca envie a senha no chat.

## OpenRouter — próxima etapa

1. Crie a conta e uma chave em https://openrouter.ai/keys.
2. Guarde a chave; ela será cadastrada no Supabase em Edge Functions → Secrets como `OPENROUTER_API_KEY`.
3. Não coloque essa chave no HTML, JavaScript ou em `config.js`.
4. A função no servidor verificará a sessão e o acesso ao atendimento antes de solicitar um resumo neutro, sem diagnóstico, tratamento ou classificação de risco.

A chamada à IA será implementada na próxima etapa. A interface atual comunica que o resumo está indisponível.

## Copiar para Downloads

O ambiente atual escreve na pasta de trabalho. Para copiar o projeto para Downloads, use PowerShell:

```powershell
Copy-Item -LiteralPath "$env:USERPROFILE\Documents\Codex\2026-11-21\new-chat\MedPrior" -Destination "$env:USERPROFILE\Downloads\MedPrior" -Recurse
```

Se já existir uma cópia em Downloads, confirme o destino e evite misturar duas versões durante o desenvolvimento. A cópia em Downloads não é atualizada automaticamente por esta sessão.
