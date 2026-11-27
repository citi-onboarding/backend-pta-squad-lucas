process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/node_boilerplate_test";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
process.env.LOG_LEVEL ??= "silent";
process.env.ERP_API_URL ??= "https://erp.example.invalid";
process.env.ERP_API_KEY ??= "fake-erp-key-for-tests";
process.env.ERP_SYNC_ENABLED ??= "false";
