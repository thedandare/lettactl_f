export interface Run {
  id: string;
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  agent_id: string;
  created_at: string;
  completed_at?: string;
  stop_reason?: string;
  background?: boolean;
}
