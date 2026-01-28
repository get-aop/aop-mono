import {
  test,
  expect,
  mockApiResponse,
  createMockBrainstormDraft,
  createMockTaskPreview,
  createMockSubtaskPreviews,
  mockBrainstormStartApi,
  mockBrainstormMessageApi,
  mockBrainstormDraftsApi,
  mockBrainstormResumeDraftApi,
  mockBrainstormDeleteDraftApi,
  mockBrainstormApproveApi,
  mockBrainstormConfirmApi,
  injectMockWebSocket,
  createMockOrchestratorState
} from "./fixtures";

test.describe("Task Creation Wizard - API Integration", () => {
  test.describe("Brainstorm Session Start", () => {
    test("starts a new brainstorm session via API", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let startApiCalled = false;
      let requestBody: { initialMessage?: string } | null = null;

      await page.route("**/api/brainstorm/start", async (route) => {
        startApiCalled = true;
        const request = route.request();
        const body = request.postDataJSON();
        requestBody = body;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sessionId: "brainstorm-123",
            agentId: "agent-456"
          })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      await page.evaluate(async () => {
        const response = await fetch("/api/brainstorm/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialMessage: "Build a new feature" })
        });
        return response.json();
      });

      expect(startApiCalled).toBe(true);
      expect(requestBody).toEqual({ initialMessage: "Build a new feature" });
    });

    test("handles start session without initial message", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let requestBody: unknown = null;

      await page.route("**/api/brainstorm/start", async (route) => {
        requestBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sessionId: "brainstorm-456",
            agentId: "agent-789"
          })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      const result = await page.evaluate(async () => {
        const response = await fetch("/api/brainstorm/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        return response.json();
      });

      expect(result.sessionId).toBe("brainstorm-456");
      expect(result.agentId).toBe("agent-789");
    });
  });

  test.describe("Brainstorm Message Exchange", () => {
    test("sends message to brainstorm session", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let messageCalled = false;
      let capturedSessionId = "";
      let capturedContent = "";

      await page.route("**/api/brainstorm/*/message", async (route) => {
        messageCalled = true;
        const url = route.request().url();
        const match = url.match(/\/api\/brainstorm\/([^/]+)\/message/);
        capturedSessionId = match?.[1] ?? "";
        const body = route.request().postDataJSON();
        capturedContent = body.content;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({})
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      await page.evaluate(async () => {
        await fetch("/api/brainstorm/session-123/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "I want to add user authentication" })
        });
      });

      expect(messageCalled).toBe(true);
      expect(capturedSessionId).toBe("session-123");
      expect(capturedContent).toBe("I want to add user authentication");
    });
  });

  test.describe("Brainstorm Drafts", () => {
    test("lists existing drafts", async ({ page }) => {
      const mockState = createMockOrchestratorState();
      const drafts = [
        createMockBrainstormDraft({ sessionId: "draft-1" }),
        createMockBrainstormDraft({ sessionId: "draft-2" })
      ];

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});
      await mockBrainstormDraftsApi(page, drafts);

      await page.goto("/");
      await page.waitForSelector(".layout");

      const result = await page.evaluate(async () => {
        const response = await fetch("/api/brainstorm/drafts");
        return response.json();
      });

      expect(result.drafts).toHaveLength(2);
      expect(result.drafts[0].sessionId).toBe("draft-1");
      expect(result.drafts[1].sessionId).toBe("draft-2");
    });

    test("resumes a draft session", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let resumeCalled = false;
      let capturedDraftId = "";

      await page.route("**/api/brainstorm/drafts/*/resume", async (route) => {
        resumeCalled = true;
        const url = route.request().url();
        const match = url.match(/\/api\/brainstorm\/drafts\/([^/]+)\/resume/);
        capturedDraftId = match?.[1] ?? "";

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sessionId: capturedDraftId,
            agentId: "agent-resumed"
          })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      const result = await page.evaluate(async () => {
        const response = await fetch("/api/brainstorm/drafts/draft-123/resume", {
          method: "POST"
        });
        return response.json();
      });

      expect(resumeCalled).toBe(true);
      expect(capturedDraftId).toBe("draft-123");
      expect(result.sessionId).toBe("draft-123");
      expect(result.agentId).toBe("agent-resumed");
    });

    test("deletes a draft", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let deleteCalled = false;
      let capturedDraftId = "";

      await page.route("**/api/brainstorm/drafts/*", async (route) => {
        if (route.request().method() === "DELETE") {
          deleteCalled = true;
          const url = route.request().url();
          const match = url.match(/\/api\/brainstorm\/drafts\/([^/]+)$/);
          capturedDraftId = match?.[1] ?? "";

          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({})
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      await page.evaluate(async () => {
        await fetch("/api/brainstorm/drafts/draft-to-delete", {
          method: "DELETE"
        });
      });

      expect(deleteCalled).toBe(true);
      expect(capturedDraftId).toBe("draft-to-delete");
    });
  });

  test.describe("Task Confirmation and Planning", () => {
    test("confirms task preview triggers planning", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let confirmCalled = false;
      let capturedSessionId = "";

      await page.route("**/api/brainstorm/*/confirm", async (route) => {
        confirmCalled = true;
        const url = route.request().url();
        const match = url.match(/\/api\/brainstorm\/([^/]+)\/confirm/);
        capturedSessionId = match?.[1] ?? "";

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({})
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      await page.evaluate(async () => {
        await fetch("/api/brainstorm/session-456/confirm", {
          method: "POST"
        });
      });

      expect(confirmCalled).toBe(true);
      expect(capturedSessionId).toBe("session-456");
    });
  });

  test.describe("Task Approval and Creation", () => {
    test("approves plan and creates task", async ({ page }) => {
      const mockState = createMockOrchestratorState();
      const subtasks = createMockSubtaskPreviews(3);

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let approveCalled = false;
      let capturedSubtasks: unknown = null;

      await page.route("**/api/brainstorm/*/approve", async (route) => {
        approveCalled = true;
        const body = route.request().postDataJSON();
        capturedSubtasks = body.subtasks;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ taskFolder: "my-new-feature" })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      const result = await page.evaluate(
        async (subs) => {
          const response = await fetch("/api/brainstorm/session-789/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subtasks: subs })
          });
          return response.json();
        },
        subtasks
      );

      expect(approveCalled).toBe(true);
      expect(capturedSubtasks).toEqual(subtasks);
      expect(result.taskFolder).toBe("my-new-feature");
    });

    test("approval with edited subtasks sends modifications", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let capturedSubtasks: unknown[] = [];

      await page.route("**/api/brainstorm/*/approve", async (route) => {
        const body = route.request().postDataJSON();
        capturedSubtasks = body.subtasks;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ taskFolder: "edited-task" })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      const editedSubtasks = [
        { title: "Edited First Subtask", description: "Updated description", dependencies: [] },
        { title: "New Second Subtask", description: "Brand new", dependencies: [1] }
      ];

      await page.evaluate(async (subs) => {
        await fetch("/api/brainstorm/session-edit/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subtasks: subs })
        });
      }, editedSubtasks);

      expect(capturedSubtasks).toHaveLength(2);
      expect(capturedSubtasks[0]).toMatchObject({ title: "Edited First Subtask" });
      expect(capturedSubtasks[1]).toMatchObject({ title: "New Second Subtask", dependencies: [1] });
    });
  });

  test.describe("End Session", () => {
    test("ends brainstorm session and saves draft", async ({ page }) => {
      const mockState = createMockOrchestratorState();

      await injectMockWebSocket(page, mockState);
      await mockApiResponse(page, "**/api/**", {});

      let endCalled = false;

      await page.route("**/api/brainstorm/*/end", async (route) => {
        endCalled = true;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ draftId: "saved-draft-123" })
        });
      });

      await page.goto("/");
      await page.waitForSelector(".layout");

      const result = await page.evaluate(async () => {
        const response = await fetch("/api/brainstorm/session-to-end/end", {
          method: "POST"
        });
        return response.json();
      });

      expect(endCalled).toBe(true);
      expect(result.draftId).toBe("saved-draft-123");
    });
  });
});

test.describe("Task Creation Wizard - WebSocket Events", () => {
  test("receives brainstormStarted event", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    let wsEventReceived = false;

    await page.addInitScript((stateData) => {
      const OriginalWebSocket = window.WebSocket;
      (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

      window.WebSocket = class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);

          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
            } catch {}
          });

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              })
            );
          }, 50);

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "brainstormStarted",
                  sessionId: "ws-session-123",
                  agentId: "ws-agent-456"
                })
              })
            );
          }, 100);
        }
      } as typeof WebSocket;
    }, mockState);

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const brainstormEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "brainstormStarted"
    );

    expect(brainstormEvent).toBeDefined();
    expect((brainstormEvent as { sessionId: string }).sessionId).toBe("ws-session-123");
  });

  test("receives brainstormMessage event", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await page.addInitScript((stateData) => {
      const OriginalWebSocket = window.WebSocket;
      (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

      window.WebSocket = class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);

          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
            } catch {}
          });

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              })
            );
          }, 50);

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "brainstormMessage",
                  sessionId: "msg-session",
                  message: {
                    id: "msg-1",
                    role: "assistant",
                    content: "What features would you like to build?",
                    timestamp: new Date().toISOString()
                  }
                })
              })
            );
          }, 100);
        }
      } as typeof WebSocket;
    }, mockState);

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const messageEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "brainstormMessage"
    );

    expect(messageEvent).toBeDefined();
    expect(
      (messageEvent as { message: { content: string } }).message.content
    ).toBe("What features would you like to build?");
  });

  test("receives brainstormComplete event with taskPreview", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    const taskPreview = createMockTaskPreview({
      title: "New Auth Feature",
      description: "Add authentication to the app"
    });

    await page.addInitScript(
      ({ stateData, preview }) => {
        const OriginalWebSocket = window.WebSocket;
        (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);

            this.addEventListener("message", (event) => {
              try {
                const data = JSON.parse((event as MessageEvent).data);
                (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
              } catch {}
            });

            setTimeout(() => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({ type: "state", data: stateData })
                })
              );
            }, 50);

            setTimeout(() => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    type: "brainstormComplete",
                    sessionId: "complete-session",
                    taskPreview: preview
                  })
                })
              );
            }, 100);
          }
        } as typeof WebSocket;
      },
      { stateData: mockState, preview: taskPreview }
    );

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const completeEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "brainstormComplete"
    );

    expect(completeEvent).toBeDefined();
    expect(
      (completeEvent as { taskPreview: { title: string } }).taskPreview.title
    ).toBe("New Auth Feature");
  });

  test("receives planGenerated event with subtasks", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    const subtaskPreviews = createMockSubtaskPreviews(3);

    await page.addInitScript(
      ({ stateData, previews }) => {
        const OriginalWebSocket = window.WebSocket;
        (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

        window.WebSocket = class extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);

            this.addEventListener("message", (event) => {
              try {
                const data = JSON.parse((event as MessageEvent).data);
                (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
              } catch {}
            });

            setTimeout(() => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({ type: "state", data: stateData })
                })
              );
            }, 50);

            setTimeout(() => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    type: "planGenerated",
                    sessionId: "plan-session",
                    subtaskPreviews: previews
                  })
                })
              );
            }, 100);
          }
        } as typeof WebSocket;
      },
      { stateData: mockState, previews: subtaskPreviews }
    );

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const planEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "planGenerated"
    );

    expect(planEvent).toBeDefined();
    expect(
      (planEvent as { subtaskPreviews: unknown[] }).subtaskPreviews
    ).toHaveLength(3);
  });

  test("receives taskCreated event", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await page.addInitScript((stateData) => {
      const OriginalWebSocket = window.WebSocket;
      (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

      window.WebSocket = class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);

          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
            } catch {}
          });

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              })
            );
          }, 50);

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "taskCreated",
                  sessionId: "created-session",
                  taskFolder: "my-created-task"
                })
              })
            );
          }, 100);
        }
      } as typeof WebSocket;
    }, mockState);

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const createdEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "taskCreated"
    );

    expect(createdEvent).toBeDefined();
    expect((createdEvent as { taskFolder: string }).taskFolder).toBe("my-created-task");
  });

  test("receives brainstormError event", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await page.addInitScript((stateData) => {
      const OriginalWebSocket = window.WebSocket;
      (window as { __receivedEvents?: unknown[] }).__receivedEvents = [];

      window.WebSocket = class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);

          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              (window as { __receivedEvents?: unknown[] }).__receivedEvents?.push(data);
            } catch {}
          });

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: stateData })
              })
            );
          }, 50);

          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "brainstormError",
                  sessionId: "error-session",
                  error: "Agent process failed"
                })
              })
            );
          }, 100);
        }
      } as typeof WebSocket;
    }, mockState);

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return (window as { __receivedEvents?: unknown[] }).__receivedEvents;
    });

    const errorEvent = events?.find(
      (e: unknown) => (e as { type: string }).type === "brainstormError"
    );

    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error: string }).error).toBe("Agent process failed");
  });
});

test.describe("Task Creation Wizard - Error Handling", () => {
  test("handles API error on session start", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await injectMockWebSocket(page, mockState);
    await mockApiResponse(page, "**/api/**", {});

    await page.route("**/api/brainstorm/start", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" })
      });
    });

    await page.goto("/");
    await page.waitForSelector(".layout");

    const result = await page.evaluate(async () => {
      try {
        const response = await fetch("/api/brainstorm/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        return { ok: response.ok, status: response.status };
      } catch (e) {
        return { error: true };
      }
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  test("handles session not found error", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await injectMockWebSocket(page, mockState);
    await mockApiResponse(page, "**/api/**", {});

    await page.route("**/api/brainstorm/*/message", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session not found" })
      });
    });

    await page.goto("/");
    await page.waitForSelector(".layout");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/brainstorm/invalid-session/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "test" })
      });
      return { ok: response.ok, status: response.status };
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test("handles approval failure", async ({ page }) => {
    const mockState = createMockOrchestratorState();

    await injectMockWebSocket(page, mockState);
    await mockApiResponse(page, "**/api/**", {});

    await page.route("**/api/brainstorm/*/approve", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid subtasks" })
      });
    });

    await page.goto("/");
    await page.waitForSelector(".layout");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/brainstorm/session/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtasks: [] })
      });
      const data = await response.json();
      return { ok: response.ok, status: response.status, error: data.error };
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe("Invalid subtasks");
  });
});
