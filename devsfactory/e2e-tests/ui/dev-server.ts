import dashboard from "../../packages/dashboard/index.html";

const server = Bun.serve({
  port: 3001,
  routes: {
    "/": dashboard
  },
  development: {
    hmr: true,
    console: true
  }
});

console.log(`Dashboard server running at http://localhost:${server.port}`);
