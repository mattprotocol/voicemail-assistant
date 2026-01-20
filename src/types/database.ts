export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      gmail_tokens: {
        Row: {
          id: string
          account_email: string
          access_token: string
          refresh_token: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          account_email: string
          access_token: string
          refresh_token: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          account_email?: string
          access_token?: string
          refresh_token?: string
          expires_at?: string
          created_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          account_email: string
          status: string
          queue_snapshot: Json
          current_index: number
          started_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_email: string
          status: string
          queue_snapshot: Json
          current_index?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          account_email?: string
          status?: string
          queue_snapshot?: Json
          current_index?: number
          started_at?: string
          updated_at?: string
        }
      }
      undo_actions: {
        Row: {
          id: string
          session_id: string
          action_type: string
          gmail_thread_id: string
          reverse_action: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          session_id: string
          action_type: string
          gmail_thread_id: string
          reverse_action: Json
          created_at?: string
          expires_at: string
        }
        Update: {
          id?: string
          session_id?: string
          action_type?: string
          gmail_thread_id?: string
          reverse_action?: Json
          created_at?: string
          expires_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
