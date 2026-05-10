import type { AgentTool } from "../types.js";
import { echoTool } from "./echo.js";
import { calculatorTool } from "./calculator.js";
import { bashTool } from "./bash/index.js";
import { webFetchTool } from "./web-fetch/index.js";

export const builtinTools: AgentTool[] = [echoTool, calculatorTool, bashTool, webFetchTool];

export { echoTool } from "./echo.js";
export { calculatorTool } from "./calculator.js";
export { bashTool } from "./bash/index.js";
export { webFetchTool } from "./web-fetch/index.js";
