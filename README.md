# Gerenciador de Projetos

Sistema completo de gerenciamento de projetos com hierarquia de permissões, sprints, timeline gráfica, árvores de pessoas e projetos, e CRM básico para sugestões.

## Stack Tecnológica

- **Backend**: Django 5.2.10 com Django REST Framework
- **Frontend**: React 18+ com TypeScript
- **Banco de Dados**: PostgreSQL
- **Autenticação**: Session-based (Django padrão)
- **Animações**: Framer Motion
- **API**: REST API

## Estrutura do Projeto

```
BWAproj/
├── backend/          # API Django
│   ├── apps/
│   │   ├── accounts/      # Usuários e autenticação
│   │   ├── projects/      # Projetos, Sprints, Cards
│   │   ├── teams/         # Equipes e hierarquia
│   │   ├── timeline/      # Timeline de projetos
│   │   └── suggestions/    # CRM de sugestões
│   └── config/            # Configurações Django
└── frontend/         # Aplicação React
    └── src/
        ├── components/    # Componentes reutilizáveis
        ├── pages/         # Páginas da aplicação
        ├── services/      # Serviços de API
        └── context/       # Context API
```

## Instalação

### Backend

1. Navegue até a pasta backend:
```bash
cd backend
```

2. Ative o ambiente virtual:
```bash
# Windows
.\venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Instale as dependências:
```bash
pip install -r requirements.txt
```

4. Configure o banco de dados PostgreSQL e crie um arquivo `.env` baseado no `.env.example`:
```env
DB_NAME=bwaproj_db
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

5. Execute as migrações:
```bash
python manage.py makemigrations
python manage.py migrate
```

6. Crie um superusuário:
```bash
python manage.py createsuperuser
```

7. Inicie o servidor:
```bash
python manage.py runserver
```

### Frontend

1. Navegue até a pasta frontend:
```bash
cd frontend
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor de desenvolvimento:
```bash
npm start
```

## Funcionalidades

### Sistema de Permissões

- **Admin**: Todas as permissões
- **Supervisor**: Criar sprints, definir prazos, avaliar projetos, gerenciar equipes
- **Gerente de Projetos**: Atribuir projetos a desenvolvedores, solicitar adiamentos
- **Desenvolvedor**: Trabalhar em projetos atribuídos, adicionar eventos/comentários

### Principais Funcionalidades

- ✅ Sistema de autenticação com sessões
- ✅ CRUD de Sprints (apenas Supervisor)
- ✅ CRUD de Projetos com atribuição de desenvolvedores
- ✅ CRUD de Cards dentro dos Projetos
- ✅ Sistema de eventos (Pendências, Prioridades, Tags)
- ✅ Timeline gráfica de projetos
- ✅ Árvore de Pessoas (hierarquia)
- ✅ Árvore de Projetos (Sprint → Projetos → Cards)
- ✅ Sistema de sugestões com pipeline CRM
- ✅ Gerenciamento de equipes
- ✅ Controle de acesso baseado em roles

## API Endpoints

### Autenticação
- `POST /api/users/login/` - Login
- `POST /api/users/logout/` - Logout
- `GET /api/users/me/` - Usuário atual

### Sprints
- `GET /api/sprints/` - Listar sprints
- `POST /api/sprints/` - Criar sprint
- `GET /api/sprints/{id}/` - Detalhes da sprint
- `PATCH /api/sprints/{id}/` - Atualizar sprint
- `DELETE /api/sprints/{id}/` - Deletar sprint

### Projetos
- `GET /api/projects/` - Listar projetos
- `POST /api/projects/` - Criar projeto
- `GET /api/projects/{id}/` - Detalhes do projeto
- `PATCH /api/projects/{id}/` - Atualizar projeto
- `DELETE /api/projects/{id}/` - Deletar projeto

### Cards
- `GET /api/cards/` - Listar cards
- `POST /api/cards/` - Criar card
- `GET /api/cards/{id}/` - Detalhes do card
- `PATCH /api/cards/{id}/` - Atualizar card
- `DELETE /api/cards/{id}/` - Deletar card

### Timeline
- `GET /api/timeline/` - Listar entradas da timeline
- `POST /api/timeline/` - Criar entrada

### Sugestões
- `GET /api/suggestions/` - Listar sugestões
- `POST /api/suggestions/` - Criar sugestão
- `PATCH /api/suggestions/{id}/` - Atualizar sugestão

## Deploy com Docker (recomendado)

Para subir **banco (PostgreSQL), backend (Django + Daphne) e frontend** de uma vez:

```bash
docker compose up -d
```

Acesse **http://localhost:8000**. Depois crie um usuário admin: `docker compose exec backend python manage.py createsuperuser`.  
Detalhes em **[DOCKER.md](DOCKER.md)**.

## Backup do banco (produção)

Na VPS (`/opt/bwa_tech`) o backup é diário e automático — `scripts/backup-diario.sh`, agendado no cron:

```cron
MAILTO=rpa@bwa.global
0 3 * * * /opt/bwa_tech/scripts/backup-diario.sh
```

O script faz `pg_dump -Fc` do container do Postgres, grava em `backups/bwa_tech_diario_AAAAMMDD_HHMMSS.dump.gz`,
mantém os últimos 14 dias (`BACKUP_RETENCAO_DIAS`) e **falha com código != 0** se o dump sair vazio ou
muito menor que o do dia anterior — o cron avisa por e-mail só quando algo dá errado. Histórico em
`backups/backup-diario.log`.

Para voltar atrás a partir de um backup (na raiz do projeto, na VPS):

```bash
ls -lh backups/
./scripts/restore-prod-docker.sh backups/bwa_tech_diario_AAAAMMDD_HHMMSS.dump.gz
```

**Antes de qualquer deploy com migrations** vale gerar um dump avulso na hora com
`./scripts/dump-prod-postgres.sh` — o diário das 3h pode estar a quase 24 horas de distância.
Para trazer um dump de produção para o PC de dev: `.\scripts\fetch-prod-dump.ps1 -VpsHost <IP>` e
depois `.\scripts\restore-local-docker.ps1`.

## Deploy em rede local (sem Docker)

Para rodar em um servidor local e acessar por **localhost** ou pelo **IP da máquina** na rede (sem domínio por enquanto), siga o guia **[DEPLOY_REDE_LOCAL.md](DEPLOY_REDE_LOCAL.md)**. Resumo: build do frontend (`npm run build`), configurar `.env` do backend e subir com `daphne -b 0.0.0.0 -p 8000 config.asgi:application`. Acesso em **http://localhost:8000** ou **http://IP:8000**.

Para depois usar um domínio (ex: bwatech.com.br), use o **[DEPLOY_LOCAL.md](DEPLOY_LOCAL.md)**.

## Desenvolvimento

O projeto está estruturado para facilitar o desenvolvimento contínuo. As funcionalidades principais estão implementadas e podem ser expandidas conforme necessário.

## Licença

Este projeto é privado.
