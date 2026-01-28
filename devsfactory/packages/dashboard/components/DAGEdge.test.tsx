import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { DAGEdge, generateBezierPath } from "./DAGEdge";

describe("generateBezierPath", () => {
  test("generates quadratic bezier path from source to target", () => {
    const path = generateBezierPath({ x: 160, y: 30 }, { x: 240, y: 30 });
    expect(path).toContain("M 160 30");
    expect(path).toContain("Q");
  });

  test("creates control point between source and target", () => {
    const path = generateBezierPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(path).toContain("100 0");
  });

  test("handles vertical offset between nodes", () => {
    const path = generateBezierPath({ x: 160, y: 30 }, { x: 240, y: 130 });
    expect(path).toContain("M 160 30");
    expect(path).toContain("240 130");
  });
});

describe("DAGEdge", () => {
  test("renders path element", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGEdge sourceX={160} sourceY={30} targetX={240} targetY={30} />
      </svg>
    );
    expect(html).toContain("<path");
  });

  test("applies stroke color", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGEdge sourceX={160} sourceY={30} targetX={240} targetY={30} />
      </svg>
    );
    expect(html).toContain("stroke=");
  });

  test("sets fill to none", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGEdge sourceX={160} sourceY={30} targetX={240} targetY={30} />
      </svg>
    );
    expect(html).toContain('fill="none"');
  });

  test("includes marker reference for arrow", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGEdge sourceX={160} sourceY={30} targetX={240} targetY={30} />
      </svg>
    );
    expect(html).toContain("marker-end");
  });

  test("renders with quadratic bezier command", () => {
    const html = renderToString(
      <svg role="img" aria-label="test">
        <DAGEdge sourceX={160} sourceY={30} targetX={240} targetY={30} />
      </svg>
    );
    expect(html).toContain(" Q ");
  });
});
