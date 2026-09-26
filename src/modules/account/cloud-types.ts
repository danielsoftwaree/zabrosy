// Hand-written shape of the two tables in supabase/migrations/202609260001_survey_cloud.sql.
// Keep it in sync with that migration until database type generation is configured.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type BaseRow = { id: string; owner_id: string; document: Json; revision: number; updated_at: string; deleted_at: string | null }
type SessionRow = BaseRow
type CastRow = BaseRow & { session_id: string }

export type CloudDatabase = {
  public: {
    Tables: {
      survey_sessions: {
        Row: SessionRow
        Insert: Pick<SessionRow, 'id' | 'owner_id' | 'document'> & Partial<Pick<SessionRow, 'revision' | 'updated_at' | 'deleted_at'>>
        Update: Partial<SessionRow>
        Relationships: []
      }
      survey_casts: {
        Row: CastRow
        Insert: Pick<CastRow, 'id' | 'session_id' | 'owner_id' | 'document'> & Partial<Pick<CastRow, 'revision' | 'updated_at' | 'deleted_at'>>
        Update: Partial<CastRow>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
