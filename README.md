**DoaStock**  
Sistema de Gestão de Inventário e Doações para Organizações Sociais  

<img width="1402" height="768" alt="Mockup Doa Stock" src="https://github.com/user-attachments/assets/f1bb9200-fdbf-444a-b9af-ab895a650b54" />
<br>
   
 Progressive Web App (PWA) · FastAPI (Serverless) · Supabase · PostgreSQL  
**Divisão de Responsabilidades**  
| | | |  
|-|-|-|  
| **Dupla** | **Integrantes** | **Ficheiros** |   
| **Dupla 1 – Interface & Design** | Lucas Silva Pessoa · Thaina Oliveira Araújo | index.html · style.css |   
| **Dupla 2 – Lógica Frontend** | Guilherme Gomes da Silva · Daniel Michel Vieira Lopes | script.js |   
| **Dupla 3 – Backend & Dados** | Leandra dos Santos Caetano Garcia · Pedro Henrique Tavares Maciel de Souza | api/index.py · vercel.json · supabase.sql |   
   
**Stack Tecnológica (Arquitetura Serverless)**  
| | |  
|-|-|  
| **Camada** | **Tecnologia** |   
| **Frontend** | HTML5 · CSS3 (variáveis custom, estilo Shadcn) · JavaScript ES2024 |   
| **Backend** | Python 3.12 · FastAPI (Serverless Functions) · Vercel Cron Jobs |   
| **Base de dados** | PostgreSQL 16 via Supabase |   
| **Autenticação** | JWT (PyJWT) + bcrypt |   
| **E-mail transacional** | SendGrid |   
| **Alojamento (Fullstack)** | Vercel (Frontend estático + Backend Serverless) |   
   
**Funcionalidades MVP**  
- **Dashboard** com semáforo de criticidade por categoria, alertas de vencimento e métricas consolidadas.  
- **Entrada de Itens** com leitor de código de barras EAN-13/QR Code via câmara do dispositivo.  
- **Controlo de Validade** com alertas automáticos por e-mail (gerido pelo Cron Job do Vercel diariamente às 6h).  
- **Módulo Público de Necessidades** sem login — para os doadores verificarem os itens urgentes.  
- **Relatórios de Impacto** com métricas de receção e distribuição de donativos.  
- **Gestão de Utilizadores** com perfis coordinator / volunteer / donor.  
**Estrutura de Ficheiros**  
A arquitetura foi otimizada para implantação direta e gratuita no Vercel:  
doastock/  
 ├── api/  
 │   └── index.py      # Backend FastAPI (Serverless Functions)  
 ├── index.html        # SPA com todas as páginas e views do Frontend  
 ├── style.css         # Design system (tokens, componentes, layout)  
 ├── script.js         # Lógica frontend, roteamento, chamadas à API  
 ├── vercel.json       # Configuração de rotas e Cron Jobs do Vercel  
 ├── supabase.sql      # Schema PostgreSQL + views + seed inicial do Supabase  
 ├── requirements.txt  # Dependências Python (apenas as necessárias para Serverless)  
 └── README.md         # Documentação do projeto  
   
**Deploy Rápido (GitHub + Vercel)**  
1. Envie esta pasta para um repositório no GitHub.  
2. Crie a base de dados no Supabase e execute o código do ficheiro supabase.sql.  
3. Ligue o repositório ao Vercel.  
4. Configure as seguintes variáveis de ambiente (Environment Variables) no painel do Vercel:  
- SUPABASE_URL: O URL do seu projeto Supabase.  
- SUPABASE_SERVICE_KEY: A chave secreta service_role do Supabase.  
- JWT_SECRET: Uma chave secreta longa gerada por si.  
- SENDGRID_API_KEY: (Opcional) Chave para disparo de e-mails.  
**Credenciais de Demonstração**  
Após correr o script supabase.sql na base de dados, utilize as seguintes credenciais para aceder ao sistema:  

| **Campo** | **Valor** |   
| **E-mail** | coordenador@doastock.org |   
| **Password** | doastock123 |   
   
**Licença**  
Projeto académico — SENAC · Tecnologia em Análise e Desenvolvimento de Sistemas · 2026  
