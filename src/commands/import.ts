import { LettaClientWrapper } from '../lib/letta-client';
import * as fs from 'fs';
import * as path from 'path';

export default async function importCommand(
  file: string,
  options: { 
    name?: string;
    appendCopy?: boolean;
    embedding?: string;
    overrideTools?: boolean;
    stripMessages?: boolean;
    secrets?: string;
    envVars?: string;
  }, 
  command: any
) {
  const verbose = command.parent?.opts().verbose || false;
  
  try {
    const client = new LettaClientWrapper();

    // Validate file exists
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Import file not found: ${file}`);
    }

    if (verbose) {
      console.log(`Importing from: ${resolvedPath}`);
      const stats = fs.statSync(resolvedPath);
      console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
    }

    // Prepare import options
    const importOptions: any = {};
    
    if (options.name) importOptions.name = options.name;
    if (options.appendCopy) importOptions.append_copy_suffix = true;
    if (options.embedding) importOptions.embedding = options.embedding;
    if (options.overrideTools) importOptions.override_existing_tools = true;
    if (options.stripMessages) importOptions.strip_messages = true;
    if (options.secrets) importOptions.secrets = options.secrets;
    if (options.envVars) importOptions.env_vars_json = options.envVars;

    if (verbose && Object.keys(importOptions).length > 0) {
      console.log('Import options:', JSON.stringify(importOptions, null, 2));
    }

    // Create file stream and import
    const fileStream = fs.createReadStream(resolvedPath);
    
    const importResponse = await client.importAgent(fileStream, importOptions);
    
    if (importResponse.agent_ids && importResponse.agent_ids.length > 0) {
      console.log(`Successfully imported ${importResponse.agent_ids.length} agent(s):`);
      for (const agentId of importResponse.agent_ids) {
        console.log(`  - ${agentId}`);
      }
    } else {
      console.log('Import completed but no agent IDs returned');
    }
    
    if (verbose) {
      console.log('Import response:', JSON.stringify(importResponse, null, 2));
    }

  } catch (error: any) {
    console.error(`Failed to import agent from ${file}:`, error.message);
    throw error;
  }
}