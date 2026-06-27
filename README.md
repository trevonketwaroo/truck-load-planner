# Truck Load Planner

A standalone web app for planning and optimizing truck loads across multiple delivery stops. Visualizes packing in 3D using Three.js, supports per-stop item grouping, weight balancing, and load-order sheets.

## Local setup

```bash
npm install
cp .env.example .env
# Edit .env and set DATABASE_URL to a PostgreSQL connection string
npm start
# Open http://localhost:5060
```

The server runs migrations automatically on startup — no manual schema setup needed.

## Copy products from the original app

If you have an existing product catalog in another database, run:

```bash
SOURCE_DATABASE_URL=postgres://... DATABASE_URL=postgres://... node copy-products.js
```

This truncates the local `products` table and re-inserts all rows from the source.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_PASSWORD` | No | If set, enables password auth. Unset = open API. |
| `PORT` | No | HTTP port (default: 5060) |
| `SOURCE_DATABASE_URL` | copy-products only | Source DB for the product copy script |

## Deploy to Render

1. Push this directory to a GitHub repo.
2. In Render, create a new Web Service and connect the repo.
3. Render picks up `render.yaml` automatically (Blueprint deploy).
4. Set `DATABASE_URL` to your Neon or Render Postgres connection string in the Render dashboard.
5. Optionally set `APP_PASSWORD` to protect the API.
