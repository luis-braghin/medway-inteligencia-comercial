# Segurança e privacidade

O repositório contém somente código permitido e dados fictícios gerados por fórmula. Credenciais, fontes originais, agregados reais da apresentação, evidências privadas e pacotes privados de ingestão estão excluídos. `.gitignore` é uma proteção auxiliar; a verificação por allowlist e a revisão dos arquivos antecedem cada publicação.

`npm run verify:public` verifica arquivos autorizados e padrões de credenciais. Isso complementa, mas não substitui, a revisão de conteúdo. Marcadores de senha e token nos testes são fixtures artificiais para simular limites de segurança; não são credenciais válidas.

O demo escuta apenas `127.0.0.1`, valida Host e Origin, aceita GET/HEAD, aplica CSP e não expõe o diretório do projeto. Não configure esse servidor como acesso remoto a dados reais.

No portal hospedado, o navegador recebe agregados depois da autenticação. As sessões usam cookie host-only, Secure, HttpOnly e SameSite, com revogação no backend. A identidade do gateway é separada da identidade do avaliador; o Worker não utiliza chave administrativa nem a senha do avaliador como binding. Autenticação e ativos com resultados reais exigem sessão.

Não compartilhe a senha de avaliação no README, issues, commits ou URL. Uma implantação própria exige revisão de políticas/RPCs, bindings, origem permitida, expiração, revogação e limites. Os testes simulados não comprovam por si só a segurança de uma implantação externa.
