#!/usr/bin/env node

import { Command } from 'commander';
import { applyCommand } from './commands/apply';
import getCommand from './commands/get';
import deleteCommand from './commands/delete';
import describeCommand from './commands/describe';
import updateCommand from './commands/update';
import exportCommand from './commands/export';
import importCommand from './commands/import';
import createCommand from './commands/create';

// Validate required environment variables
function validateEnvironment() {
  if (!process.env.LETTA_API_URL) {
    console.error('Error: LETTA_API_URL environment variable is required');
    console.error('Set it with: export LETTA_API_URL=http://localhost:8283');
    process.exit(1);
  }
  
  // API key required unless localhost (self-hosting)
  const isLocalhost = process.env.LETTA_API_URL.includes('localhost');
  
  if (!isLocalhost && !process.env.LETTA_API_KEY) {
    console.error(`Error: LETTA_API_KEY is required for Letta Cloud (${process.env.LETTA_API_URL})`);
    console.error('Set it with: export LETTA_API_KEY=your_api_key');
    process.exit(1);
  }
}

const program = new Command();

program
  .name('lettactl')
  .description('kubectl-style CLI for managing Letta AI agent fleets')
  .version('0.1.0')
  .option('-v, --verbose', 'enable verbose output')
  .hook('preAction', validateEnvironment);

// Apply command - deploy fleet from YAML
program
  .command('apply')
  .description('Deploy agents from configuration')
  .option('-f, --file <path>', 'agent YAML configuration file', 'agents.yml')
  .option('--agent <pattern>', 'deploy only agents matching pattern')
  .option('--dry-run', 'show what would be created without making changes')
  .action(applyCommand);

// Get command - list/show agents
program
  .command('get')
  .description('Display agents')
  .argument('<resource>', 'resource type (agents)')
  .argument('[name]', 'specific agent name (optional)')
  .option('-o, --output <format>', 'output format (table|json|yaml)', 'table')
  .action(getCommand);

// Describe command - detailed agent info
program
  .command('describe')
  .description('Show detailed information about an agent')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('-o, --output <format>', 'output format (table, json)', 'table')
  .action(describeCommand);

// Delete command - remove agents
program
  .command('delete')
  .description('Delete an agent')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('--force', 'force deletion without confirmation')
  .action(deleteCommand);

// Create command - create new agents
program
  .command('create')
  .description('Create a new agent')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('-d, --description <text>', 'agent description')
  .option('-m, --model <model>', 'LLM model (e.g., google_ai/gemini-2.5-pro)')
  .option('-s, --system <text>', 'system prompt')
  .option('-c, --context-window <number>', 'context window size', parseInt)
  .option('-e, --embedding <embedding>', 'embedding model')
  .option('-t, --timezone <timezone>', 'agent timezone')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--agent-type <type>', 'agent type')
  .option('--tools <tools>', 'comma-separated tool IDs')
  .option('--memory-blocks <blocks>', 'comma-separated memory block IDs')
  .action(createCommand);

// Update command - modify existing agents
program
  .command('update')
  .description('Update an existing agent')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('-n, --name <name>', 'new agent name')
  .option('-d, --description <text>', 'new description')
  .option('-m, --model <model>', 'new LLM model')
  .option('-s, --system <text>', 'new system prompt')
  .option('-c, --context-window <number>', 'new context window size', parseInt)
  .option('-e, --embedding <embedding>', 'new embedding model')
  .option('-t, --timezone <timezone>', 'new timezone')
  .option('--tags <tags>', 'comma-separated tags')
  .action(updateCommand);

// Export command - export agents to files
program
  .command('export')
  .description('Export an agent to a file')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('-o, --output <file>', 'output filename')
  .option('--max-steps <number>', 'maximum steps to export', parseInt)
  .option('--legacy-format', 'use legacy v1 format')
  .action(exportCommand);

// Import command - import agents from files
program
  .command('import')
  .description('Import an agent from a file')
  .argument('<file>', 'path to agent export file')
  .option('-n, --name <name>', 'override agent name')
  .option('--append-copy', 'append "_copy" suffix to agent name')
  .option('-e, --embedding <embedding>', 'override embedding model')
  .option('--override-tools', 'allow overwriting existing tool source code')
  .option('--strip-messages', 'remove agent messages during import')
  .option('--secrets <json>', 'secrets JSON string')
  .option('--env-vars <json>', 'environment variables JSON string')
  .action(importCommand);

// Validate command - check YAML config
program
  .command('validate')
  .description('Validate agent configuration')
  .option('-f, --file <path>', 'agent YAML configuration file', 'agents.yml')
  .action(async (options) => {
    console.log('Validate command:', options);
    // TODO: Implement validate logic
  });

// Logs command - show agent conversation logs
program
  .command('logs')
  .description('Show agent conversation logs')
  .argument('<resource>', 'resource type (agent)')
  .argument('<name>', 'agent name')
  .option('--tail <lines>', 'number of recent messages to show')
  .action(async (resource, name, options) => {
    console.log('Logs command:', resource, name, options);
    // TODO: Implement logs logic
  });

// Config command - show current Letta config
program
  .command('config')
  .description('Manage Letta configuration')
  .command('view')
  .description('Show current Letta configuration')
  .action(async () => {
    console.log('Config view command');
    // TODO: Implement config view logic
  });

program.parse();