import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";

export const calculatorTool: AgentTool = {
  name: "calculator",
  description:
    "Performs basic arithmetic operations (add, subtract, multiply, divide).",
  parameters: Type.Object({
    operation: Type.Union(
      [
        Type.Literal("add"),
        Type.Literal("subtract"),
        Type.Literal("multiply"),
        Type.Literal("divide"),
      ],
      { description: "The arithmetic operation to perform" }
    ),
    a: Type.Number({ description: "First operand" }),
    b: Type.Number({ description: "Second operand" }),
  }),
  execute: ({ args }) => {
    const a = args.a as number;
    const b = args.b as number;
    const op = args.operation as string;

    let result: number;
    switch (op) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) return { type: "error", content: "Division by zero" };
        result = a / b;
        break;
      default:
        return { type: "error", content: `Unknown operation: ${op}` };
    }

    return { type: "text", content: `${a} ${op} ${b} = ${result}` };
  },
};
