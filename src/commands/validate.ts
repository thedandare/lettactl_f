import { FleetParser } from '../lib/fleet-parser';
import { SupabaseStorageBackend } from '../lib/storage-backend';

export async function validateCommand(options: { file: string }) {
  try {
    console.log(`Validating configuration: ${options.file}`);
    
    // Initialize Supabase backend if environment variables are available
    let supabaseBackend: SupabaseStorageBackend | undefined;
    
    try {
      if (process.env.SUPABASE_URL || process.env.SUPABASE_ANON_KEY) {
        supabaseBackend = new SupabaseStorageBackend();
        console.log('Supabase backend configured for validation');
      }
    } catch (error: any) {
      console.error(`Supabase configuration error: ${error.message}`);
      process.exit(1);
    }
    
    const parser = new FleetParser(options.file, { supabaseBackend });
    await parser.parseFleetConfig(options.file);
    
    console.log('Configuration is valid.');
  } catch (error: any) {
    console.error('Configuration validation failed:');
    console.error(error.message);
    process.exit(1);
  }
}