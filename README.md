# NeuralVault API

NestJS + Prisma + PostgreSQL backend foundation for NeuralVault.

Required environment variables:
- DATABASE_URL
- JWT_SECRET
- WEBHOOK_SECRET
- PORT (optional)

Local commands:
- npm install
- npx prisma generate --schema schema.prisma
- npm run build
- npm start

This backend is a development/foundation implementation. Real-money deployment requires verified payment webhooks, KYC/AML, security review, reconciliation, and applicable regulatory controls.
