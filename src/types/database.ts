export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      gmail_tokens: {
        Row: {
          access_token: string
          account_email: string
          created_at: string | null
          expires_at: string
          id: string
          refresh_token: string
        }
        Insert: {
          access_token: string
          account_email: string
          created_at?: string | null
          expires_at: string
          id?: string
          refresh_token: string
        }
        Update: {
          access_token?: string
          account_email?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          account_email: string
          current_index: number | null
          id: string
          queue_snapshot: Json
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          account_email: string
          current_index?: number | null
          id?: string
          queue_snapshot?: Json
          started_at?: string | null
          status: string
          updated_at?: string | null
        }
        Update: {
          account_email?: string
          current_index?: number | null
          id?: string
          queue_snapshot?: Json
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      undo_actions: {
        Row: {
          action_type: string
          created_at: string | null
          expires_at: string
          gmail_thread_id: string
          id: string
          reverse_action: Json
          session_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          expires_at: string
          gmail_thread_id: string
          id?: string
          reverse_action: Json
          session_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          expires_at?: string
          gmail_thread_id?: string
          id?: string
          reverse_action?: Json
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "undo_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper types for easier usage
export type GmailToken = Database['public']['Tables']['gmail_tokens']['Row']
export type GmailTokenInsert = Database['public']['Tables']['gmail_tokens']['Insert']
export type GmailTokenUpdate = Database['public']['Tables']['gmail_tokens']['Update']

export type Session = Database['public']['Tables']['sessions']['Row']
export type SessionInsert = Database['public']['Tables']['sessions']['Insert']
export type SessionUpdate = Database['public']['Tables']['sessions']['Update']

export type UndoAction = Database['public']['Tables']['undo_actions']['Row']
export type UndoActionInsert = Database['public']['Tables']['undo_actions']['Insert']
export type UndoActionUpdate = Database['public']['Tables']['undo_actions']['Update']

// Queue snapshot item type
export interface QueueItem {
  position: number
  gmail_thread_id: string
  sender: string
  subject: string
  timestamp: string
}

// Session status enum
export type SessionStatus = 'active' | 'paused' | 'completed'

// Undo action type enum
export type ActionType = 'archive' | 'delete' | 'star' | 'mark_unread'
