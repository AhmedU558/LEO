# LEO Production Deployment Guide

## Architecture

- Gateway: Node.js/Hono API server
- Database: PostgreSQL (with persistent volumes)
- Workers: Embedded background schedulers (Node.js)
- Edge Proxy: Nginx or Traefik for SSL termination

## Environment Setup

Copy .env.example to .env and fill in the production secrets.
Ensure that NODE_ENV=production is set.

## Docker Deployment

1. Build the production image:
   \docker build -t ownpilot/leo:latest .\
2. Run via Docker Compose (using \docker-compose.prod.yml\):
   \docker-compose -f docker-compose.prod.yml up -d\

## Database Configuration

- Requires PostgreSQL 15+
- Ensure connection pool is appropriately sized.
- Migrations run automatically on gateway startup.

## Security Considerations

- Ensure the \/api/v1/health\ diagnostics are protected.
- LEO defaults to rejecting unsafe host executions. Do not modify PolicyEngine bounds.
- All secrets must be securely provided via environment variables, not hardcoded.
