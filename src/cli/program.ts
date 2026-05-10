#!/usr/bin/env node
import "tsx/esm";
import { Command } from "commander";
import { addGatewayCommand } from "./commands/gateway.js";
import { addChatCommand } from "./commands/chat.js";
import { addPluginsCommand } from "./commands/plugins.js";
import { addOnboardCommand } from "./commands/onboard.js";
import { addProvidersCommand } from "./commands/providers.js";
import { addModelsCommand } from "./commands/models.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("mini-claw")
  .description("Mini-Claw: A personal AI assistant inspired by OpenClaw")
  .version(VERSION);

addOnboardCommand(program);
addProvidersCommand(program);
addModelsCommand(program);
addGatewayCommand(program);
addChatCommand(program);
addPluginsCommand(program);

program.parse();
