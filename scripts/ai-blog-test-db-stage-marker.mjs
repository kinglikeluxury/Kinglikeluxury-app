if (process.argv.includes("--diagnostic-markers")) {
  process.stderr.write("AI_BLOG_TEST_DB_PHASE=PRELOAD_READY\n");
}
