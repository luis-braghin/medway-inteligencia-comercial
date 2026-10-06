# Medway · Inteligência comercial

Dashboard de vendas B2C, contratos B2B e composição mensal com premissas explícitas. Desenvolvido por Luiz para o case técnico de Sales Ops / RevOps, com assistência de IA na análise, implementação e revisão.

**[Abrir o portal do case](https://medway-inteligencia.luisz-braghin.workers.dev/#b2c)** · **[Abrir a apresentação completa](https://medway-inteligencia.luisz-braghin.workers.dev/#presentation)**

O portal exige a senha de avaliação, entregue separadamente. Este repositório público é a **edição reproduzível com dados 100% sintéticos**: inclui interface, parsers, fórmulas, DTO e testes de segurança. Não contém dados reais, credenciais, a pesquisa privada da apresentação ou componentes privados de ingestão.

![Dashboard executando a demonstração sintética](docs/demo.jpg)

## Executar localmente

Requer Node.js 22 ou superior. A demonstração e os testes usam apenas bibliotecas nativas; não é necessário instalar dependências, configurar banco ou fornecer credenciais.

```sh
git clone https://github.com/luis-braghin/medway-inteligencia-comercial.git
cd medway-inteligencia-comercial
npm test
npm run verify:public
npm start
```

Abra **http://127.0.0.1:4517**. Para alterar a porta: `PORT=4600 npm start` em macOS/Linux; `$env:PORT='4600'; npm start` em PowerShell. O servidor se limita à interface loopback e não serve arquivos fora da allowlist.

## O que explorar

- **Vendas B2C:** saldo observado, linhas positivas, ticket positivo, evolução mensal, canais, produtos e CSV do recorte.
- **Contratos B2B:** status atual, licenças, plano e região; valor mensal em unidades da fonte, pois a moeda não é informada.
- **Visão conjunta:** componentes separados e cenário mensal em BRL sob hipóteses explícitas. Total financeiro oficial indisponível.
- **Fontes e qualidade:** hashes sintéticos, versões, advertências e definições dos indicadores.
- **Apresentação pública:** cinco slides explicando a solução, sem os resultados privados. A apresentação completa está no portal.

Use o filtro de período, consulte as definições dos cartões e navegue pela busca com `Ctrl K`. Tabelas largas têm rolagem horizontal. A apresentação admite setas, Home, End e Esc.

## Estrutura e validação

| Área | Implementação |
| --- | --- |
| Fontes fictícias determinísticas | `src/demo-data.mjs` |
| Parsing, normalização e qualidade | `src/normalize.mjs` |
| Fórmulas e projeções em centavos inteiros | `src/views.mjs` |
| Resposta agregada por allowlist | `src/dashboard-dto.mjs` |
| Interface responsiva | `dashboard/dist/` |
| Demo HTTP local | `src/demo-server.mjs` |
| Código do portal protegido e cliente RPC | `src/hosted-app.mjs`, `src/portal-client.mjs` |
| Regressões, fórmulas, contratos e segurança | `tests/` |

Os testes usam entradas sintéticas e serviços simulados. Exercitam exatidão monetária, preservação de negativos/zero, snapshots incompletos, versão inconsistente, exclusão de campos privados, acesso sem sessão, identidade do gateway, logout, CSRF, limites de corpo e timeout. Os testes de portal não contatam Cloudflare ou Supabase.

Consulte [arquitetura e limites](docs/ARCHITECTURE.md), [segurança](docs/SECURITY.md) e [guia da entrega](docs/DELIVERY.md).

## Limites analíticos

Uma linha positiva não comprova cliente único, venda única, pagamento ou margem. O snapshot B2B não reconstrói vigência nem churn histórico; seu campo mensal não é homologado como MRR. O cenário assume BRL, status atual, coexistência e mês cheio desde o início do contrato. Datas de captura e publicação não comprovam atualização factual da fonte.

Os resultados sintéticos permitem avaliar código e interação; não sustentam conclusões comerciais sobre a Medway. Marcas mencionadas pertencem a seus titulares. A presença pública do código não concede licença sobre dados ou componentes privados excluídos.
