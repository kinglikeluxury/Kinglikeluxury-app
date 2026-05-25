import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Check for required environment variable
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}

// Configure connection pool with better error handling and retry logic
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close connections after 30 seconds of inactivity
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
});

// Handle pool errors to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't throw here - let individual queries handle their own errors
});

export const db = drizzle({ client: pool, schema });

// Database operation wrapper with retry logic
export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if this is a connection-related error that we should retry
      const isConnectionError = error.code === '57P01' || // terminating connection due to administrator command
                               error.code === '57P03' || // cannot connect now
                               error.code === '08006' || // connection failure
                               error.code === '08S01' || // communication link failure
                               error.code === 'ECONNRESET' ||
                               error.code === 'ENOTFOUND' ||
                               error.code === 'ETIMEDOUT' ||
                               error.code === 'EAI_AGAIN' ||
                               error.message?.includes('Connection terminated') ||
                               error.message?.includes('WebSocket closed') ||
                               error.message?.includes('SQL client must be connected') ||
                               error.message?.includes('server closed the connection unexpectedly');
      
      if (isConnectionError && attempt < maxRetries) {
        console.warn(`Database operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }
      
      // If it's not a connection error or we've exhausted retries, throw the error
      throw error;
    }
  }
  
  throw lastError!;
}

console.log("Database connection established");