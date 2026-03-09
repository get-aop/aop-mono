import { describe, expect, test } from "bun:test";
import { buildWslCommand } from "./wsl-command";

describe("buildWslCommand", () => {
  test("quotes env values in export statements", () => {
    const fullCommand = buildWslCommand("/home/test/.aop/aop-server", {
      AOP_DB_PATH: "/home/test/My Folder/aop.db",
      AOP_SECRET_TOKEN: "token;$HOME && echo hi",
    });

    expect(fullCommand).toContain("export AOP_DB_PATH='/home/test/My Folder/aop.db'");
    expect(fullCommand).toContain("export AOP_SECRET_TOKEN='token;$HOME && echo hi'");
    expect(fullCommand).toContain("exec /home/test/.aop/aop-server");
  });

  test("escapes single quotes inside env values", () => {
    const fullCommand = buildWslCommand("echo ok", {
      AOP_NAME: "O'Reilly",
    });

    expect(fullCommand).toContain("export AOP_NAME='O'\\''Reilly'");
  });

  test("does not prepend an empty export segment", () => {
    expect(buildWslCommand("echo ok", {})).toBe("exec echo ok");
  });
});
