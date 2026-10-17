# url shortener

## Setup

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
```

## Docker compose

**Start Server**
```bash
docker compose up --build
```
**Stop Server**
```bash
docker compose down # Add -v to also delete volumes
```

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
