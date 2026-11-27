-- Dani: a tela sugeria "gemini-2.5-flash" como modelo. Com as chaves novas do Google ele não responde (404),
-- e quando responde leva mais de 25 s. Quem salvou um dos modelos antigos volta para o automático
-- (modelos "lite", ~2 s). Quem escolheu outro modelo continua com a escolha.
delete from fab.sistema where chave = 'gemini_modelo' and valor in ('gemini-2.5-flash', 'gemini-2.0-flash');
