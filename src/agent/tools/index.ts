import type { AgentTool } from "../types.js";
import { echoTool } from "./echo.js";
import { calculatorTool } from "./calculator.js";
import { dateTimeTool } from "./date-time.js";
import { bashTool } from "./bash/index.js";
import { webFetchTool } from "./web-fetch/index.js";
import { webSearchTool } from "./web-search/index.js";

export const builtinTools: AgentTool[] = [
  echoTool,
  calculatorTool,
  dateTimeTool,
  bashTool,
  webFetchTool,
  webSearchTool,
];

export { echoTool } from "./echo.js";
export { calculatorTool } from "./calculator.js";
export { dateTimeTool } from "./date-time.js";
export { bashTool } from "./bash/index.js";
export { webFetchTool } from "./web-fetch/index.js";
export { webSearchTool } from "./web-search/index.js";
