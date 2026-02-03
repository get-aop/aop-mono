if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start the database with: docker compose up -d postgres\n" +
      "Then set: TEST_DATABASE_URL=postgresql://aop:aop@localhost:5433/aop_test",
  );
}
