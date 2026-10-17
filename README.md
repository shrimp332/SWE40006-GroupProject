# url shortener

## Setup

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
```

## Docker compose

The top level compose file is for dev only. `infra/` holds the staging and production ones.

**Start Server**
```bash
docker compose up --build
```
**Stop Server**
```bash
docker compose down # Add -v to also delete volumes
```

## Production
This will be handled automatically with a github action

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env pull
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d
```

## Staging

`100.126.136.48:8080`, deployed by CI on every PR and merge to main. Each deploy wipes the database.

## Workflows

| Workflow | Trigger | Does |
| --- | --- | --- |
| `tests` | every push | backend tests |
| `staging` | PR and merge to main | frontend checks, deploy to staging, e2e against it |
| `ghcr` | merge to main | pushes `:latest` images to GHCR |

## Tests

Backend unit and integration tests, needs `TEST_DATABASE_URL` in `backend/.env`:

```bash
cd backend
npm test
```

End-to-end tests, needs the compose stack already running:

```bash
cd frontend
npm run test:e2e
npm run test:e2e:watch    # visible browser, slowed down
```

First run only: `npx playwright install chromium`.

`E2E_BASE_URL` points the suite at another host, e.g. staging.
